/**
 * Screen Classifier — Orchestrator
 *
 * Precedence logic (exact, no blending):
 *
 *   1. Always run heuristic first (0ms, deterministic).
 *   2. If heuristic score >= 0.90 → use heuristic result directly.
 *      CLIP is NOT called at all in this path.
 *   3. Only if heuristic returns default "general" (score 0.80, no match)
 *      → trigger CLIP classification via the offscreen document.
 *   4. If CLIP is not yet loaded → return heuristic default immediately,
 *      schedule background CLIP load for future calls.
 *
 * This is an explicit if/else — never averaged, never blended.
 */

import { createLogger } from '../log';
import { heuristicClassify, labelToPrivacyLevel } from './heuristicClassifier';
import type { ClassificationResult } from './heuristicClassifier';

const logger = createLogger('ScreenClassifier');

// ── Offscreen document management ────────────────────────────────────────────
// Reuses the SAME offscreen document as face detection (MV3 single-offscreen limit)
const OFFSCREEN_URL = chrome.runtime.getURL('offscreen/vision-offscreen.html');
const OFFSCREEN_REASON = 'USER_MEDIA' as chrome.offscreen.Reason;

let offscreenCreating: Promise<void> | null = null;
let clipModelReady = false;

async function ensureOffscreenDocument(): Promise<void> {
  // Check for EITHER the new merged URL or legacy face-detector URL
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });

  if (contexts.length > 0) return; // any offscreen doc already exists

  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [OFFSCREEN_REASON],
    justification: 'Run CLIP zero-shot classifier + face-api.js for visual PII detection',
  });

  try {
    await offscreenCreating;
  } finally {
    offscreenCreating = null;
  }
}

/**
 * Triggers CLIP model loading in the offscreen document (non-blocking).
 * Called in the background when heuristic returns default "general".
 */
function scheduleClipLoad(): void {
  if (clipModelReady) return;

  ensureOffscreenDocument()
    .then(() => {
      chrome.runtime.sendMessage({ type: 'PRELOAD_CLIP' }).then(response => {
        if (response?.ready) {
          clipModelReady = true;
          logger.info('[ScreenClassifier] CLIP model loaded and cached ✅');
        }
      }).catch(() => {
        // Offscreen doc not ready yet — will retry on next call
      });
    })
    .catch(err => logger.warning('Could not schedule CLIP preload:', err));
}

/**
 * Calls CLIP zero-shot classification via the offscreen document.
 * Only called when heuristic returns default "general".
 */
async function classifyWithClip(screenshotB64: string): Promise<ClassificationResult> {
  try {
    await ensureOffscreenDocument();

    const response = await chrome.runtime.sendMessage({
      type: 'CLASSIFY_SCREEN',
      screenshotB64,
    });

    if (response?.error || !response?.label) {
      logger.warning('CLIP classification error:', response?.error);
      return { label: 'general', score: 0.60, source: 'clip', privacyLevel: 'low' };
    }

    clipModelReady = true;

    return {
      label: response.label,
      score: response.score,
      source: 'clip',
      privacyLevel: labelToPrivacyLevel(response.label),
    };
  } catch (err) {
    logger.warning('CLIP classify failed:', err);
    return { label: 'general', score: 0.60, source: 'clip', privacyLevel: 'low' };
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Classify the current screen using the heuristic-first / CLIP-fallback strategy.
 *
 * PRECEDENCE RULE (explicit if/else, no blending):
 *  - Heuristic wins when score >= 0.90 (URL match OR sensitive DOM field found).
 *  - CLIP decides only when heuristic returns default "general" (score 0.80).
 *
 * @param screenshotB64 - Base64 JPEG screenshot (no data: prefix)
 * @param pageUrl       - Full URL of the active tab
 * @param domText       - Visible text from the page (first ~4000 chars)
 */
export async function classifyScreen(
  screenshotB64: string,
  pageUrl: string,
  domText: string,
): Promise<ClassificationResult> {

  // ── Step 1: Always run heuristic first (0ms) ──────────────────────────────
  const heuristicResult = heuristicClassify(pageUrl, domText);

  // ── Step 2: PRECEDENCE — heuristic wins when confident ───────────────────
  if (heuristicResult.score >= 0.90) {
    // Strong URL or DOM pattern match found.
    // DO NOT call CLIP. Return heuristic result immediately.
    logger.info(
      `[ScreenClassifier] Heuristic → ${heuristicResult.label} (${heuristicResult.score}) [CLIP skipped]`
    );
    return heuristicResult;
  }

  // ── Step 3: Heuristic returned default "general" → use CLIP ──────────────
  // Heuristic found nothing (score 0.80). CLIP is the authority now.

  if (!clipModelReady) {
    // CLIP not yet loaded. Return heuristic default immediately (non-blocking).
    // Schedule background load so next calls will have CLIP ready.
    logger.info('[ScreenClassifier] CLIP not ready yet — using heuristic default, scheduling load');
    scheduleClipLoad();

    return heuristicResult; // { label: 'general', score: 0.80, privacyLevel: 'low' }
  }

  // CLIP is loaded — get its classification
  logger.info('[ScreenClassifier] Heuristic found no match → using CLIP');
  const clipResult = await classifyWithClip(screenshotB64);

  logger.info(
    `[ScreenClassifier] CLIP → ${clipResult.label} (${clipResult.score.toFixed(3)})`
  );

  return clipResult;
}

export type { ClassificationResult, PrivacyLevel, ClassificationSource } from './heuristicClassifier';
