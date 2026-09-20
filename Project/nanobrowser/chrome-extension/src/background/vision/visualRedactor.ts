/**
 * Visual Redactor — Module 2 (Privacy Shadow Edition)
 *
 * Takes a base64 JPEG/PNG screenshot + bounding boxes (from Module 1)
 * and returns a sanitized base64 PNG with sensitive regions obscured.
 *
 * Uses OffscreenCanvas (available in MV3 service workers).
 *
 * Redaction strategy per bbox type:
 *   face         → pixelate (8×8 block fill) — NO label
 *   img_element  → pixelate when no faces detected (nuclear fallback)
 *   password     → solid black + green <CREDENTIAL> label
 *   credit_card  → solid black + green <CARD_NUMBER> label
 *   aadhaar_field→ solid black + green <IDENTITY_ID> label
 *   pan_field    → solid black + green <TAX_ID> label
 *   otp_field    → solid black + green <OTP> label
 *   email_field  → solid black + green <EMAIL> label
 *   phone_field  → solid black + green <PHONE> label
 *   pii_text     → solid black + green label based on piiType
 *
 * Nuclear Fallback:
 *   If face detection returns 0 faces AND the page has img_element bboxes
 *   (from DOM scan) that are large enough to contain a face (>= MIN_FACE_FALLBACK_PX
 *   in both width and height), those image regions are pixelated as a safety net.
 *   This guards against TinyFaceDetector failures on real-world web portraits.
 */

/** Minimum px size (w AND h) for an img_element bbox to trigger nuclear fallback pixelation */
const MIN_FACE_FALLBACK_PX = 80;

import type { VisualBbox } from './visualPiiDetector';

export interface RedactionResult {
  sanitizedImageB64: string;   // base64 PNG (no data: prefix)
  mimeType: 'image/png';
  redactionReport: RedactionReport;
}

export interface RedactionReport {
  totalRegions: number;
  facesRedacted: number;
  fieldsRedacted: number;
  pixelsCovered: number;
}

const BLOCK_SIZE = 10; // pixels per pixelation block

/**
 * Maps bbox type → semantic token label shown to the VLM.
 * Faces return null (no label — pure visual redaction only).
 */
const TYPE_TO_TOKEN: Record<string, string | null> = {
  face: null,              // no label — black/pixelate only
  password: 'CREDENTIAL',
  credit_card: 'CARD_NUMBER',
  aadhaar_field: 'IDENTITY_ID',
  pan_field: 'TAX_ID',
  otp_field: 'OTP',
  email_field: 'EMAIL',
  phone_field: 'PHONE',
  pii_text: 'REDACTED',    // fallback — overridden by piiType below
};

/**
 * Maps piiType string (from piiDetector) → token label.
 */
const PII_TYPE_TO_TOKEN: Record<string, string> = {
  AADHAAR: 'IDENTITY_ID',
  PAN: 'TAX_ID',
  PASSWORD: 'CREDENTIAL',
  OTP: 'OTP',
  CREDIT_CARD: 'CARD_NUMBER',
  CARD_NUMBER: 'CARD_NUMBER',
  CVV: 'CARD_SECURITY',
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  BANK_ACCOUNT: 'FINANCIAL_ID',
  UPI_ID: 'FINANCIAL_ID',
  IFSC: 'FINANCIAL_ID',
  PASSPORT: 'IDENTITY_ID',
  VOTER_ID: 'IDENTITY_ID',
  DRIVING_LICENSE: 'IDENTITY_ID',
};

/**
 * Resolves the token label for a given bbox.
 * Returns null for face regions (no label rendered).
 */
function resolveTokenLabel(bbox: VisualBbox): string | null {
  if (bbox.type === 'face') return null;

  // For pii_text type, use the piiType field for a more specific token
  if (bbox.type === 'pii_text' && bbox.piiType) {
    const mapped = PII_TYPE_TO_TOKEN[bbox.piiType.toUpperCase()];
    if (mapped) return mapped;
  }

  return TYPE_TO_TOKEN[bbox.type] ?? 'REDACTED';
}

/**
 * Redacts the given screenshot in-place on an OffscreenCanvas.
 *
 * @param screenshotB64      - Base64-encoded JPEG or PNG (no data: prefix)
 * @param mimeType           - 'image/jpeg' or 'image/png'
 * @param bboxes             - Bounding boxes from Module 1
 * @param facesDetectedByML  - Number of faces found by face-api.js (0 triggers nuclear fallback)
 */
export async function redactScreenshot(
  screenshotB64: string,
  mimeType: 'image/jpeg' | 'image/png',
  bboxes: VisualBbox[],
  facesDetectedByML = 0,
): Promise<RedactionResult> {
  // 1. Decode base64 → Blob → ImageBitmap
  const binary = atob(screenshotB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const blob = new Blob([bytes], { type: mimeType });
  const imageBitmap = await createImageBitmap(blob);

  const { width, height } = imageBitmap;

  // 2. Create OffscreenCanvas and draw original image
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(imageBitmap, 0, 0);
  imageBitmap.close();

  // 3. Redact each bounding box
  let facesRedacted = 0;
  let fieldsRedacted = 0;
  let pixelsCovered = 0;

  // Nuclear fallback: if face-api found 0 faces but we have img_element bboxes
  // from the DOM scan that are large enough to contain a face, pixelate those too.
  // This guards against TinyFaceDetector failures on real-world web portraits.
  const useNuclearFallback = facesDetectedByML === 0;
  const effectiveBboxes = useNuclearFallback
    ? [
        ...bboxes,
        // Promote large img_element bboxes to 'face' type for pixelation
        ...bboxes
          .filter(b => b.type === 'img_element' && b.w >= MIN_FACE_FALLBACK_PX && b.h >= MIN_FACE_FALLBACK_PX)
          .map(b => ({ ...b, type: 'face' as const })),
      ]
    : bboxes;

  for (const bbox of effectiveBboxes) {
    // Clamp to canvas bounds
    const x = Math.max(0, bbox.x);
    const y = Math.max(0, bbox.y);
    const w = Math.min(bbox.w, width - x);
    const h = Math.min(bbox.h, height - y);

    if (w <= 0 || h <= 0) continue;

    if (bbox.type === 'face') {
      // Faces: pixelate only — no token label
      pixelateFace(ctx, x, y, w, h);
      facesRedacted++;
    } else if (bbox.type === 'img_element') {
      // img_element in non-nuclear mode: skip (already handled above if needed)
      continue;
    } else {
      // Text PII fields: black box + green semantic token label
      const tokenLabel = resolveTokenLabel(bbox);
      solidRedactWithToken(ctx, x, y, w, h, tokenLabel);
      fieldsRedacted++;
    }

    pixelsCovered += w * h;
  }

  // 4. Export as PNG blob → base64
  const outBlob = await canvas.convertToBlob({ type: 'image/png' });
  const arrBuf = await outBlob.arrayBuffer();
  const outBytes = new Uint8Array(arrBuf);
  let b64 = '';
  const chunk = 8192;
  for (let i = 0; i < outBytes.length; i += chunk) {
    b64 += String.fromCharCode(...outBytes.subarray(i, i + chunk));
  }
  const sanitizedB64 = btoa(b64);

  return {
    sanitizedImageB64: sanitizedB64,
    mimeType: 'image/png',
    redactionReport: {
      totalRegions: bboxes.length,
      facesRedacted,
      fieldsRedacted,
      pixelsCovered,
    },
  };
}

// ─── Redaction helpers ───────────────────────────────────────────────────────

/**
 * Solid black fill + semantic token label overlay (Privacy Shadow).
 * For password fields, PAN, Aadhaar, OTP, credit cards, etc.
 *
 * @param tokenLabel - e.g. 'CREDENTIAL', 'IDENTITY_ID', or null for no label
 */
function solidRedactWithToken(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  tokenLabel: string | null,
): void {
  // Black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, w, h);

  // Green semantic label — only for text PII (not faces)
  if (tokenLabel) {
    const label = `<${tokenLabel}>`;
    const fontSize = Math.max(9, Math.min(Math.floor(h * 0.52), 13));
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillStyle = '#00E5A0'; // green — visible against black background

    // Measure text and center it in the box
    const metrics = ctx.measureText(label);
    const textX = x + Math.max(3, (w - metrics.width) / 2);
    const textY = y + h * 0.67;

    ctx.fillText(label, textX, textY, w - 6); // maxWidth = w-6 prevents overflow
  }
}

/**
 * Pixelation effect — for face regions. No label rendered.
 * Samples the average color of each BLOCK_SIZE×BLOCK_SIZE cell and fills it.
 */
function pixelateFace(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
): void {
  const blockSize = Math.max(12, Math.floor(Math.min(w, h) / 5));
  // Draw the region to a tiny canvas then scale back up
  const tmpCanvas = new OffscreenCanvas(Math.max(1, Math.floor(w / blockSize)), Math.max(1, Math.floor(h / blockSize)));
  const tmpCtx = tmpCanvas.getContext('2d')!;

  // Draw small
  tmpCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, tmpCanvas.width, tmpCanvas.height);

  // Draw back at full size with pixelation (disabling smoothing)
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmpCanvas, 0, 0, tmpCanvas.width, tmpCanvas.height, x, y, w, h);
  ctx.imageSmoothingEnabled = true;

  // Add PrivacyShield tint and border over face region
  ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}
