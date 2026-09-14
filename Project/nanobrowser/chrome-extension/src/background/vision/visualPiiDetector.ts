/**
 * Visual PII Detector — Module 1
 *
 * Detects PII regions in a browser screenshot using two strategies:
 *   A) DOM bounding-box extraction (password inputs, PAN/Aadhaar fields)
 *   B) Face detection via face-api.js TinyFaceDetector (loaded in offscreen doc)
 *
 * Returns a list of bounding boxes [{x, y, w, h, type, confidence}] in
 * screenshot-pixel space, ready for Module 2 (Visual Redactor).
 */

export type BboxType =
  | 'face'
  | 'password'
  | 'credit_card'
  | 'aadhaar_field'
  | 'pan_field'
  | 'otp_field'
  | 'email_field'
  | 'phone_field'
  | 'pii_text';

export interface VisualBbox {
  x: number;
  y: number;
  w: number;
  h: number;
  type: BboxType;
  confidence: number; // 0-1
  /** Concrete PII class for pii_text / field boxes (audit log). */
  piiType?: string;
}

export interface PiiDetectionReport {
  bboxes: VisualBbox[];
  facesFound: number;
  domFieldsFound: number;
  textPiiFound: number;
  screenshotWidth: number;
  screenshotHeight: number;
}

// ─── Strategy A: DOM bboxes (serialised from content-script) ─────────────────

/**
 * Converts DOM bbox results (returned from scripting.executeScript)
 * into VisualBbox format.
 */
export function domBboxesToVisualBboxes(
  domBboxes: Array<{ x: number; y: number; w: number; h: number; type: string; piiType?: string }>,
): VisualBbox[] {
  return domBboxes.map(b => ({
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    type: b.type as BboxType,
    confidence: 1.0, // DOM is deterministic — full confidence
    piiType: b.piiType,
  }));
}

// ─── Strategy B: Face detection (from offscreen document) ────────────────────

export interface FaceDetectionResult {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

/**
 * Converts face-api.js detection results into VisualBbox format.
 */
export function faceDetectionsToVisualBboxes(faces: FaceDetectionResult[]): VisualBbox[] {
  return faces.map(f => ({
    x: Math.max(0, Math.round(f.x)),
    y: Math.max(0, Math.round(f.y)),
    w: Math.round(f.w),
    h: Math.round(f.h),
    type: 'face' as BboxType,
    confidence: f.score,
  }));
}

// ─── Merge + Deduplicate ─────────────────────────────────────────────────────

/**
 * Merges DOM-bbox and face-detection results, removing near-duplicate boxes
 * (IoU > threshold). Higher-confidence / more specific type wins.
 */
export function mergeAndDeduplicate(
  bboxes: VisualBbox[],
  iouThreshold = 0.4,
): VisualBbox[] {
  const sorted = [...bboxes].sort((a, b) => b.confidence - a.confidence);
  const kept: VisualBbox[] = [];

  for (const candidate of sorted) {
    const overlaps = kept.some(k => computeIoU(candidate, k) > iouThreshold);
    if (!overlaps) kept.push(candidate);
  }

  return kept;
}

function computeIoU(a: VisualBbox, b: VisualBbox): number {
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(a.x + a.w, b.x + b.w);
  const iy2 = Math.min(a.y + a.h, b.y + b.h);

  if (ix2 <= ix1 || iy2 <= iy1) return 0;

  const intersection = (ix2 - ix1) * (iy2 - iy1);
  const areaA = a.w * a.h;
  const areaB = b.w * b.h;
  return intersection / (areaA + areaB - intersection);
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Main detection function. Called from the background service worker.
 *
 * @param domBboxes  - results from chrome.scripting.executeScript(extractDomBboxes)
 * @param faceResults - results from offscreen document face-api.js detection
 * @param screenshotWidth - width of the screenshot in pixels
 * @param screenshotHeight - height of the screenshot in pixels
 */
export function buildDetectionReport(
  domBboxes: Array<{ x: number; y: number; w: number; h: number; type: string; piiType?: string }>,
  faceResults: FaceDetectionResult[],
  screenshotWidth: number,
  screenshotHeight: number,
): PiiDetectionReport {
  const domVisual = domBboxesToVisualBboxes(domBboxes);
  const faceVisual = faceDetectionsToVisualBboxes(faceResults);

  const all = [...faceVisual, ...domVisual];
  const merged = mergeAndDeduplicate(all);
  const textPiiFound = domVisual.filter(b => b.type === 'pii_text').length;
  const domFieldsFound = domVisual.length - textPiiFound;

  return {
    bboxes: merged,
    facesFound: faceVisual.length,
    domFieldsFound,
    textPiiFound,
    screenshotWidth,
    screenshotHeight,
  };
}

const FIELD_TYPE_TO_PII: Record<string, string> = {
  face: 'FACE',
  password: 'PASSWORD',
  credit_card: 'CREDIT_CARD',
  aadhaar_field: 'AADHAAR',
  pan_field: 'PAN',
  otp_field: 'OTP',
  email_field: 'EMAIL',
  phone_field: 'PHONE',
};

/**
 * Maps visual boxes to Privacy Shield PII type labels for the audit log.
 */
export function visualBboxesToPiiTypes(bboxes: VisualBbox[]): string[] {
  const seen = new Set<string>();
  for (const bbox of bboxes) {
    if (bbox.type === 'pii_text' && bbox.piiType) {
      seen.add(bbox.piiType);
      continue;
    }
    const mapped = FIELD_TYPE_TO_PII[bbox.type];
    if (mapped) seen.add(mapped);
  }
  return Array.from(seen);
}
