/**
 * Vision Pipeline — Module 4 (Orchestrator)
 *
 * End-to-end flow:
 *   1. takeScreenshot()
 *   2. extractDomBboxes() via chrome.scripting (content-script)
 *   3. detectFaces() via offscreen document (face-api.js)
 *   4. buildDetectionReport() → merged VisualBbox[]
 *   5. redactScreenshot() → sanitized base64 PNG
 *   6. redactText(domContext) → sanitized DOM text
 *   7. processWithServer(sanitized) → AgentAction[]
 *   8. executeActions(actions, page)
 *
 * Returns a full PipelineResult for the side panel to display.
 */

import type BrowserContext from '../browser/context';
import { createLogger } from '../log';
import { buildDetectionReport } from './visualPiiDetector';
import { redactScreenshot } from './visualRedactor';
import { detectFaces } from './faceDetector';
import { classifyScreen } from './screenClassifier';
import {
  processWithServer,
  checkServerHealth,
  verifyManifestWithServer,
  type AgentProcessResponse,
} from '../services/serverClient';
import { executeActions, setAlertBroadcaster, type ExecutionResult } from '../agent/actions/visionActionExecutor';
import type { GuardianAlertPayload } from '../agent/actions/liveActionGuardian';
import { redactText, redactDomContext } from '../privacy/piiRedactor';
import { SecureVault } from '../privacy/secureVault';
import { resolveActions } from '../privacy/tokenResolver';
import { signRedactedFrame, type SignedManifest } from '../privacy/egressSigner';
import type { RedactionReport } from './visualRedactor';
import type { PiiDetectionReport } from './visualPiiDetector';

const logger = createLogger('VisionPipeline');

export interface PipelineResult {
  success: boolean;
  error?: string;
  classification?: ClassificationResult;  // NEW: screen classification result
  detectionReport?: PiiDetectionReport;
  redactionReport?: RedactionReport;
  signedManifest?: SignedManifest;
  serverResponse?: AgentProcessResponse;
  executionResult?: ExecutionResult;
  durationMs: number;
}

export interface PipelineOptions {
  enableFaceDetection?: boolean;   // default: true (overridden by classification)
  enableDomExtraction?: boolean;   // default: true
  skipExecution?: boolean;         // default: false (dry-run mode)
  skipClassification?: boolean;    // default: false
  screenshotB64?: string;          // optional: pre-captured screenshot (bypasses Puppeteer)
  /** Task 3B: callback to broadcast Guardian drift alerts to the SidePanel */
  onGuardianAlert?: (payload: GuardianAlertPayload) => void;
}

export class VisionPipeline {
  private readonly browserContext: BrowserContext;

  constructor(browserContext: BrowserContext) {
    this.browserContext = browserContext;
  }

  async run(task: string, options: PipelineOptions = {}): Promise<PipelineResult> {
    const t0 = Date.now();
    const {
      enableFaceDetection = true,
      enableDomExtraction = true,
      skipExecution = false,
      skipClassification = false,
      screenshotB64: providedScreenshot,
      onGuardianAlert,
    } = options;

    // ── Task 3B: Register Guardian alert broadcaster ──────────────────────
    // Wire up the broadcast function so the Guardian can notify the SidePanel
    // when drift is detected during action execution.
    setAlertBroadcaster(onGuardianAlert ?? (() => {
      logger.warning('[Guardian] No alert broadcaster registered — drift alerts will be silent');
    }));

    try {
      // ── Step 1: Server health check ──────────────────────────────────────
      const serverUp = await checkServerHealth();
      if (!serverUp) {
        logger.warning('ShieldBrowse server not reachable — pipeline aborted');
        return {
          success: false,
          error: 'ShieldBrowse server is not running. Start it with server/start.bat',
          durationMs: Date.now() - t0,
        };
      }

      // ── Step 2: Screenshot ───────────────────────────────────────────────
      logger.info('Taking screenshot...');
      // Use pre-captured screenshot if provided (e.g. captured via captureVisibleTab
      // in the message handler before calling pipeline.run()), otherwise try Puppeteer.
      const screenshotB64: string = providedScreenshot ?? await this.takeScreenshotWithFallback();

      // ── Step 0 (runs after screenshot): Screen Classification ─────────────
      // Classification decides privacy level which controls face detection depth.
      // Heuristic is instant (0ms); CLIP only runs if heuristic returns 'general'.
      let classification: ClassificationResult | undefined;
      if (!skipClassification) {
        // Fix: service workers have no currentWindow — query all windows for the active http tab
        const allTabsForUrl = await chrome.tabs.query({ active: true });
        const activeTabForUrl = allTabsForUrl.find(t => t.url?.startsWith('http'));
        const pageUrl = activeTabForUrl?.url ?? '';
        const domTextForClassify = await this.getDomContext();
        classification = await classifyScreen(screenshotB64, pageUrl, domTextForClassify);
        logger.info(
          `[Pipeline] Screen classified: ${classification.label} ` +
          `(${classification.score.toFixed(2)}, ${classification.source}) ` +
          `→ privacyLevel=${classification.privacyLevel}`
        );
      }

      // Determine effective face-detection flag based on privacy level
      // HIGH → always run face detection
      // MEDIUM → run face detection
      // LOW (general page) → skip face detection to save resources
      const effectiveFaceDetection =
        enableFaceDetection &&
        (classification?.privacyLevel !== 'low' || classification?.source === 'heuristic_fallback');

      // ── Step 3: DOM bboxes (parallel with face detection) ────────────────
      const domBboxesPromise = enableDomExtraction
        ? this.extractDomBboxes()
        : Promise.resolve([] as Array<{ x: number; y: number; w: number; h: number; type: string }>);

      // ── Step 4: Face detection (parallel, skipped on low-risk pages) ─────
      const facesPromise = effectiveFaceDetection
        ? detectFaces(screenshotB64, 'image/jpeg')
        : Promise.resolve([]);

      const [domBboxes, faceResults] = await Promise.all([domBboxesPromise, facesPromise]);

      // ── Step 4.5: Populate SecureVault BEFORE redaction ───────────────────
      // Capture real field values from the live DOM NOW (before masking them).
      // The vault maps semantic tokens → real PII so TokenResolver can
      // substitute them back during action execution. Vault never leaves device.
      SecureVault.clear();
      const vaultEntries = domBboxes
        .filter(b => b.type !== 'face')
        .map(b => ({
          token: `<${domTypeToToken(b.type)}>`,
          realValue: (b as any).value ?? '',   // real value captured from DOM field
          fieldSelector: (b as any).selector ?? '',
          type: domTypeToToken(b.type),
        }))
        .filter(e => e.realValue.length > 0);   // only store if field has a value
      SecureVault.populate(vaultEntries);
      logger.info(`[SecureVault] Populated with ${vaultEntries.length} entries (tokens: ${SecureVault.getTokens().join(', ')})`);

      // ── Step 5: Build detection report ───────────────────────────────────
      // We need screenshot dimensions — parse from blob
      const { width: sw, height: sh } = await this.getImageDimensions(screenshotB64, 'image/jpeg');
      const detectionReport = buildDetectionReport(domBboxes, faceResults, sw, sh);
      logger.info(`Detection: ${detectionReport.facesFound} faces, ${detectionReport.domFieldsFound} DOM fields`);

      // ── Step 6: Redact screenshot ─────────────────────────────────────────
      const { sanitizedImageB64, redactionReport } = await redactScreenshot(
        screenshotB64,
        'image/jpeg',
        detectionReport.bboxes,
      );

      // ── Step 6.5: Cryptographic Egress Attestation (Signed Manifest) ──────
      let signedManifest: SignedManifest | undefined;
      try {
        signedManifest = await signRedactedFrame(
          sanitizedImageB64,
          detectionReport.bboxes.map(b => ({
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
            type: b.type,
          })),
        );
        logger.info(
          `[EgressSigner] 🛡️ Frame signed with ECDSA P-256 (hash: ${signedManifest.frameHash.slice(0, 12)}..., nonce: ${signedManifest.nonce})`,
        );

        // Optional receipt ping to verify-manifest endpoint (manifest-aware server)
        verifyManifestWithServer(signedManifest).catch(err => {
          logger.info('[EgressSigner] Manifest receipt ping:', err instanceof Error ? err.message : String(err));
        });
      } catch (err) {
        logger.warning('[EgressSigner] Signing failed (non-fatal):', err instanceof Error ? err.message : String(err));
      }

      // ── Step 7: Redact & Sanitize DOM context text (PII + IPI Defense) ──
      const rawDomContext = await this.getDomContext();
      const domRedaction = redactDomContext(rawDomContext);
      const domContext = domRedaction.redacted;
      if (domRedaction.ipiResult?.hasInjections) {
        logger.warning(
          `[IPI Sanitizer] Defanged ${domRedaction.ipiResult.strippedCount} prompt injection pattern(s): ${domRedaction.ipiResult.detectedPatterns.join(', ')}`,
        );
      }
      if (domRedaction.ipiResult?.zeroWidthCount) {
        logger.info(`[IPI Sanitizer] Stripped ${domRedaction.ipiResult.zeroWidthCount} invisible zero-width character(s)`);
      }

      // ── Step 8: Send to server ────────────────────────────────────────────
      // Server call is optional — if Ollama is OOM or server is down, return
      // classification + detection results as a partial success.
      let serverResponse: Awaited<ReturnType<typeof processWithServer>> | undefined;
      try {
        serverResponse = await processWithServer({
          screenshot: sanitizedImageB64,
          dom_context: domContext,
          task,
          redaction_report: {
            faces_redacted: redactionReport.facesRedacted,
            pii_fields_redacted: redactionReport.fieldsRedacted,
            total_regions: redactionReport.totalRegions,
          },
          signed_manifest: signedManifest,
        });
      } catch (serverErr) {
        logger.warning('Server step failed (non-fatal):', serverErr instanceof Error ? serverErr.message : String(serverErr));
        // Return partial success with classification + detection results
        return {
          success: true,
          classification,
          detectionReport,
          redactionReport,
          signedManifest,
          serverResponse: undefined,
          executionResult: undefined,
          durationMs: Date.now() - t0,
        };
      }

      // ── Step 9: Execute actions ───────────────────────────────────────────
      let executionResult: ExecutionResult | undefined;
      if (!skipExecution && serverResponse.actions.length > 0) {
        // Resolve token values → real PII values before execution
        // e.g. { value: "<IDENTITY_ID>" } → { value: "123456789012" }
        const resolvedActions = resolveActions([...serverResponse.actions]);
        const page = await this.browserContext.getCurrentPage();
        executionResult = await executeActions(resolvedActions, page);
        logger.info(
          `Executed ${executionResult.actionsSucceeded}/${executionResult.actionsAttempted} actions`,
        );
      }

      return {
        success: true,
        classification,
        detectionReport,
        redactionReport,
        signedManifest,
        serverResponse,
        executionResult,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('Vision pipeline failed:', error);
      return { success: false, error, durationMs: Date.now() - t0 };
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async extractDomBboxes(): Promise<Array<{ x: number; y: number; w: number; h: number; type: string; value: string; selector: string }>> {
    try {
      const allTabs = await chrome.tabs.query({ active: true });
      const tab = allTabs.find(t => t.url?.startsWith('http'));
      if (!tab?.id) return [];

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // Inline extraction — captures bbox + real field value for SecureVault
          const dpr = window.devicePixelRatio || 1;
          const out: Array<{ x: number; y: number; w: number; h: number; type: string; value: string; selector: string }> = [];
          const SELECTORS = [
            { sel: 'input[type="password"]', type: 'password' },
            { sel: 'input[autocomplete*="cc-number"],input[name*="card"],input[name*="cvv"]', type: 'credit_card' },
            { sel: 'input[name*="aadhaar"],input[name*="aadhar"],[data-aadhaar]', type: 'aadhaar_field' },
            { sel: 'input[name*="pan"],[data-pan]', type: 'pan_field' },
            { sel: 'input[name*="otp"],input[autocomplete="one-time-code"]', type: 'otp_field' },
          ];
          for (const { sel, type } of SELECTORS) {
            try {
              document.querySelectorAll(sel).forEach(el => {
                const r = el.getBoundingClientRect();
                if (r.width && r.height) {
                  const inputEl = el as HTMLInputElement;
                  out.push({
                    x: Math.round(r.left * dpr),
                    y: Math.round(r.top * dpr),
                    w: Math.round(r.width * dpr),
                    h: Math.round(r.height * dpr),
                    type,
                    value: inputEl.value ?? '',   // real PII value — captured for SecureVault
                    selector: `${sel}`,
                  });
                }
              });
            } catch { /* skip bad selectors */ }
          }
          return out;
        },
      });

      return results?.[0]?.result ?? [];
    } catch {
      return [];
    }
  }

  private async getDomContext(): Promise<string> {
    try {
      const allTabs = await chrome.tabs.query({ active: true });
      const tab = allTabs.find(t => t.url?.startsWith('http'));
      if (!tab?.id) return '';

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // 1. Main page visible text (capped to avoid token bloat)
          const bodyText = document.body?.innerText?.slice(0, 3000) ?? '';

          // 2. Capture non-password interactive field values.
          const fieldLines: string[] = [];
          const passwordRegex = /(password|passwd|pwd|passcode|secret|pin|otp|cvv|cvc)/i;
          const inputs = document.querySelectorAll<HTMLInputElement>(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"]):not([type="checkbox"]):not([type="radio"])'
          );
          inputs.forEach(el => {
            const type = (el.type || '').toLowerCase();
            const name = (el.name || '').toLowerCase();
            const id = (el.id || '').toLowerCase();
            const placeholder = (el.placeholder || '').toLowerCase();
            const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            const label =
              el.labels?.[0]?.innerText?.trim() ||
              el.getAttribute('placeholder') ||
              el.getAttribute('name') ||
              el.getAttribute('id') ||
              'field';

            const isPass =
              type === 'password' ||
              passwordRegex.test(name) ||
              passwordRegex.test(id) ||
              passwordRegex.test(placeholder) ||
              passwordRegex.test(ariaLabel) ||
              passwordRegex.test(label) ||
              autocomplete.includes('password') ||
              autocomplete.includes('current-password') ||
              autocomplete.includes('new-password') ||
              autocomplete.includes('one-time-code');

            if (isPass) {
              fieldLines.push(`[INPUT "${label}"]: [MASKED_PASSWORD]`);
              return;
            }

            const val = el.value?.trim();
            if (val) {
              fieldLines.push(`[INPUT "${label}"]: ${val}`);
            }
          });

          // Textareas
          const textareas = document.querySelectorAll<HTMLTextAreaElement>('textarea');
          textareas.forEach(el => {
            const label =
              el.labels?.[0]?.innerText?.trim() ||
              el.getAttribute('placeholder') ||
              el.getAttribute('name') ||
              'textarea';
            const val = el.value?.trim();
            if (val) {
              fieldLines.push(`[TEXTAREA "${label}"]: ${val}`);
            }
          });

          // Select dropdowns
          const selects = document.querySelectorAll<HTMLSelectElement>('select');
          selects.forEach(el => {
            const label =
              el.labels?.[0]?.innerText?.trim() ||
              el.getAttribute('name') ||
              'select';
            const val = el.options[el.selectedIndex]?.text?.trim();
            if (val) {
              fieldLines.push(`[SELECT "${label}"]: ${val}`);
            }
          });

          const formContext = fieldLines.length
            ? '\n\n--- FORM FIELD VALUES ---\n' + fieldLines.join('\n')
            : '';

          return bodyText + formContext;
        },
      });

      return results?.[0]?.result ?? '';
    } catch {
      return '';
    }
  }

  private async getImageDimensions(
    b64: string,
    mimeType: string,
  ): Promise<{ width: number; height: number }> {
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType });
      const bmp = await createImageBitmap(blob);
      const { width, height } = bmp;
      bmp.close();
      return { width, height };
    } catch {
      return { width: 1280, height: 720 }; // fallback
    }
  }

  /**
   * Takes a screenshot using Puppeteer if available, otherwise falls back
   * to chrome.tabs.captureVisibleTab() which works without an active agent task.
   */
  private async takeScreenshotWithFallback(): Promise<string> {
    // Attempt 1: Puppeteer (higher quality, full page possible)
    let puppeteerError: unknown = null;
    try {
      const page = await this.browserContext.getCurrentPage();
      const shot = await page.takeScreenshot();
      if (shot) {
        logger.info('[Screenshot] Puppeteer screenshot successful');
        return shot;
      }
    } catch (err) {
      puppeteerError = err;
    }

    // Attempt 2: Chrome native captureVisibleTab (works standalone, no Puppeteer needed)
    // Note: service workers have no "current window" — query all windows for an active http tab.
    logger.info('[Screenshot] Puppeteer unavailable (' + String(puppeteerError) + ') — falling back to captureVisibleTab');
    try {
      const allTabs = await chrome.tabs.query({ active: true });
      const activeTab = allTabs.find(t => t.url?.startsWith('http') && t.windowId);
      if (!activeTab?.windowId) throw new Error('No active tab found');
      const dataUrl = await chrome.tabs.captureVisibleTab(activeTab.windowId, {
        format: 'jpeg',
        quality: 80,
      });
      // Remove data URL prefix: 'data:image/jpeg;base64,'
      return dataUrl.replace(/^data:[^;]+;base64,/, '');
    } catch (fallbackErr) {
      throw new Error(`Screenshot failed. Puppeteer: ${String(puppeteerError)} | captureVisibleTab: ${String(fallbackErr)}`);
    }
  }
}

// ─── Module-level helpers ────────────────────────────────────────────────────

/**
 * Maps DOM bbox type string → Privacy Shadow token name.
 * Used to build vault entries: domTypeToToken('password') → 'CREDENTIAL'
 */
function domTypeToToken(type: string): string {
  const map: Record<string, string> = {
    password:      'CREDENTIAL',
    credit_card:   'CARD_NUMBER',
    aadhaar_field: 'IDENTITY_ID',
    pan_field:     'TAX_ID',
    otp_field:     'OTP',
    email_field:   'EMAIL',
    phone_field:   'PHONE',
  };
  return map[type] ?? 'REDACTED';
}
