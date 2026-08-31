/**
 * Visual Redactor — Module 2
 *
 * Takes a base64 JPEG/PNG screenshot + bounding boxes (from Module 1)
 * and returns a sanitized base64 PNG with sensitive regions obscured.
 *
 * Uses OffscreenCanvas (available in MV3 service workers).
 *
 * Redaction strategy per bbox type:
 *   face         → pixelate (8×8 block fill)
 *   password     → solid black rectangle
 *   credit_card  → solid black rectangle
 *   aadhaar_field→ solid black rectangle
 *   pan_field    → solid black rectangle
 *   otp_field    → solid black rectangle
 *   pii_text     → solid black rectangle
 */

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
 * Redacts the given screenshot in-place on an OffscreenCanvas.
 *
 * @param screenshotB64 - Base64-encoded JPEG or PNG (no data: prefix)
 * @param mimeType      - 'image/jpeg' or 'image/png'
 * @param bboxes        - Bounding boxes from Module 1
 */
export async function redactScreenshot(
  screenshotB64: string,
  mimeType: 'image/jpeg' | 'image/png',
  bboxes: VisualBbox[],
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

  for (const bbox of bboxes) {
    // Clamp to canvas bounds
    const x = Math.max(0, bbox.x);
    const y = Math.max(0, bbox.y);
    const w = Math.min(bbox.w, width - x);
    const h = Math.min(bbox.h, height - y);

    if (w <= 0 || h <= 0) continue;

    if (bbox.type === 'face') {
      pixelateFace(ctx, x, y, w, h);
      facesRedacted++;
    } else {
      solidRedact(ctx, x, y, w, h);
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
 * Solid black fill — for password fields, PAN, Aadhaar, etc.
 */
function solidRedact(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
): void {
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, w, h);
}

/**
 * Pixelation effect — for face regions.
 * Samples the average color of each BLOCK_SIZE×BLOCK_SIZE cell and fills it.
 */
function pixelateFace(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
): void {
  // Draw the region to a tiny canvas then scale back up
  const tmpCanvas = new OffscreenCanvas(Math.max(1, Math.floor(w / BLOCK_SIZE)), Math.max(1, Math.floor(h / BLOCK_SIZE)));
  const tmpCtx = tmpCanvas.getContext('2d')!;

  // Draw small
  tmpCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, tmpCanvas.width, tmpCanvas.height);

  // Draw back at full size with pixelation (disabling smoothing)
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmpCanvas, 0, 0, tmpCanvas.width, tmpCanvas.height, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}
