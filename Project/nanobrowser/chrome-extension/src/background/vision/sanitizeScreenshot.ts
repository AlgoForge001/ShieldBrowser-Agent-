/**
 * Shared screenshot sanitizer — the only path a screenshot may take
 * before leaving the device (LLM provider, ShieldBrowse server, or UI).
 *
 * Fail closed: callers must drop the image if this throws.
 */

import { createLogger } from '../log';
import { privacyAuditLog, AuditSource, PiiType } from '../privacy';
import { detectFaces } from './faceDetector';
import { classifyScreen } from './screenClassifier';
import type { ClassificationResult } from './heuristicClassifier';
import { buildDetectionReport, visualBboxesToPiiTypes } from './visualPiiDetector';
import type { PiiDetectionReport } from './visualPiiDetector';
import { redactScreenshot } from './visualRedactor';
import type { RedactionReport } from './visualRedactor';
import { getImageDimensions, resolveHttpTabId, scanTabForVisualPii, stripImageDataUrl } from './pageVisualScan';

const logger = createLogger('SanitizeScreenshot');

export interface SanitizeScreenshotOptions {
  screenshotB64: string;
  mimeType?: 'image/jpeg' | 'image/png';
  tabId?: number;
  pageUrl?: string;
  pageTitle?: string;
  enableFaceDetection?: boolean;
  skipClassification?: boolean;
}

export interface SanitizeScreenshotResult {
  sanitizedImageB64: string;
  mimeType: 'image/png';
  detectionReport: PiiDetectionReport;
  redactionReport: RedactionReport;
  classification?: ClassificationResult;
}

function shouldRunFaceDetection(
  enableFaceDetection: boolean,
  classification?: ClassificationResult,
): boolean {
  if (!enableFaceDetection) return false;
  if (!classification) return true;
  return classification.privacyLevel !== 'low' || classification.source === 'heuristic_fallback';
}

export async function sanitizeScreenshot(options: SanitizeScreenshotOptions): Promise<SanitizeScreenshotResult> {
  const mimeType = options.mimeType ?? 'image/jpeg';
  const screenshotB64 = stripImageDataUrl(options.screenshotB64);
  const enableFaceDetection = options.enableFaceDetection ?? true;

  const tabId = await resolveHttpTabId(options.tabId);
  if (!tabId) {
    throw new Error('No HTTP tab available to scan for visual PII');
  }

  let scan: Awaited<ReturnType<typeof scanTabForVisualPii>>;
  try {
    scan = await scanTabForVisualPii(tabId);
  } catch (err) {
    logger.warning('Page visual scan failed:', err);
    throw new Error('Visual PII page scan failed — refusing to send raw screenshot');
  }

  const pageUrl = options.pageUrl || scan.url;
  const pageTitle = options.pageTitle || scan.title;

  let classification: ClassificationResult | undefined;
  if (!options.skipClassification) {
    classification = await classifyScreen(screenshotB64, pageUrl, scan.snippet);
    logger.info(
      `[Sanitize] Screen classified: ${classification.label} ` +
        `(${classification.score.toFixed(2)}, ${classification.source}) → privacyLevel=${classification.privacyLevel}`,
    );
  }

  const runFaces = shouldRunFaceDetection(enableFaceDetection, classification);
  const faceResults = runFaces ? await detectFaces(screenshotB64, mimeType) : [];

  const { width, height } = await getImageDimensions(screenshotB64, mimeType);
  const detectionReport = buildDetectionReport(scan.boxes, faceResults, width, height);

  const { sanitizedImageB64, redactionReport } = await redactScreenshot(
    screenshotB64,
    mimeType,
    detectionReport.bboxes,
  );

  if (redactionReport.totalRegions > 0) {
    const piiTypes = visualBboxesToPiiTypes(detectionReport.bboxes).filter((t): t is PiiType =>
      Object.values(PiiType).includes(t as PiiType),
    );
    privacyAuditLog.record({
      pageUrl,
      pageTitle,
      piiTypes,
      redactedCount: redactionReport.totalRegions,
      source: AuditSource.VISUAL,
    });
  }

  logger.info(
    `[Sanitize] Redacted ${redactionReport.totalRegions} region(s) ` +
      `(faces=${redactionReport.facesRedacted}, fields=${redactionReport.fieldsRedacted})`,
  );

  return {
    sanitizedImageB64,
    mimeType: 'image/png',
    detectionReport,
    redactionReport,
    classification,
  };
}

export { shouldRunFaceDetection };
