/**
 * Face Detector — Module 1 (Strategy B)
 *
 * Runs face-api.js TinyFaceDetector inside an Offscreen Document
 * (MV3 compatible). The service worker sends the screenshot as a
 * base64 string via chrome.runtime.sendMessage to the offscreen doc,
 * which does the actual detection and responds with bounding boxes.
 *
 * Why Offscreen Document?
 *   face-api.js needs a real DOM + Canvas API (for TensorFlow.js WebGL backend).
 *   Service workers in MV3 lack both. Offscreen Documents provide them.
 */

import { createLogger } from '../log';

const logger = createLogger('FaceDetector');

// Merged offscreen document — hosts face-api.js AND CLIP classifier
// (Chrome MV3 allows only ONE offscreen document per extension)
const OFFSCREEN_URL = chrome.runtime.getURL('offscreen/vision-offscreen.html');
const OFFSCREEN_REASON = 'USER_MEDIA' as chrome.offscreen.Reason;

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

let offscreenCreating: Promise<void> | null = null;

/**
 * Ensures the offscreen document exists, creating it if needed.
 */
async function ensureOffscreenDocument(): Promise<void> {
  // Check for ANY offscreen document (not URL-specific) —
  // screenClassifier may have already created it with the same URL.
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });

  if (contexts.length > 0) return;

  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [OFFSCREEN_REASON],
    justification: 'Run face-api.js TinyFaceDetector + CLIP screen classifier for visual PII detection',
  });

  try {
    await offscreenCreating;
  } finally {
    offscreenCreating = null;
  }
}

/**
 * Sends a screenshot to the offscreen face-detector document and returns
 * an array of face bounding boxes.
 *
 * @param screenshotB64 - Base64 JPEG (no data: prefix)
 * @param mimeType      - image mime type
 * @returns Array of face bounding boxes
 */
export async function detectFaces(
  screenshotB64: string,
  mimeType = 'image/jpeg',
): Promise<FaceBox[]> {
  try {
    await ensureOffscreenDocument();

    const response = await chrome.runtime.sendMessage({
      type: 'DETECT_FACES',
      screenshotB64,
      mimeType,
    });

    if (response?.error) {
      logger.warning('Face detection offscreen error:', response.error);
      return [];
    }

    return (response?.faces as FaceBox[]) ?? [];
  } catch (err) {
    // Offscreen docs may not be available in all contexts; degrade gracefully
    logger.warning('Face detection unavailable:', err);
    return [];
  }
}
