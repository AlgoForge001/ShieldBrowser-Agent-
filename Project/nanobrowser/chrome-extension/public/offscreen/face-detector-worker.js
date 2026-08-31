/**
 * Face Detector Offscreen Worker
 *
 * Runs inside the offscreen document. Loads face-api.js TinyFaceDetector
 * model and responds to DETECT_FACES messages from the service worker.
 */

let modelLoaded = false;
let modelLoading = false;
const MODELS_URL = chrome.runtime.getURL('models');

async function ensureModel() {
  if (modelLoaded) return;
  if (modelLoading) {
    // Wait for model to finish loading
    await new Promise(resolve => {
      const check = setInterval(() => {
        if (modelLoaded) { clearInterval(check); resolve(); }
      }, 100);
    });
    return;
  }

  modelLoading = true;
  try {
    // Dynamically import face-api.js (bundled by Vite)
    // Since this is a plain JS file in /public, we load via importScripts
    // or rely on face-api being globally available via the HTML page
    if (typeof faceapi === 'undefined') {
      console.warn('[FaceDetector] face-api.js not available, using empty detection');
      modelLoaded = true;
      return;
    }
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL + '/tiny_face_detector');
    modelLoaded = true;
    console.log('[FaceDetector] TinyFaceDetector model loaded');
  } catch (e) {
    console.error('[FaceDetector] Model load failed:', e);
    modelLoaded = true; // mark as "done" to avoid infinite wait
  } finally {
    modelLoading = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'DETECT_FACES') return false;

  (async () => {
    try {
      await ensureModel();

      if (typeof faceapi === 'undefined' || !faceapi.nets.tinyFaceDetector.isLoaded) {
        sendResponse({ faces: [] });
        return;
      }

      // Decode base64 image to ImageBitmap via blob
      const { screenshotB64, mimeType } = message;
      const binary = atob(screenshotB64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType || 'image/jpeg' });

      const bitmap = await createImageBitmap(blob);
      const canvas = document.getElementById('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      const detections = await faceapi.detectAllFaces(
        canvas,
        new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 })
      );

      const faces = detections.map(d => ({
        x: d.box.x,
        y: d.box.y,
        w: d.box.width,
        h: d.box.height,
        score: d.score,
      }));

      sendResponse({ faces });
    } catch (e) {
      console.error('[FaceDetector] Detection error:', e);
      sendResponse({ faces: [], error: e.message });
    }
  })();

  return true; // keep message channel open for async response
});

// Pre-load model on startup
ensureModel();
