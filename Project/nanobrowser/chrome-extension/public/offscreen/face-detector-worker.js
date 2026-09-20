/**
 * Face Detector Offscreen Worker
 *
 * Runs inside the offscreen document. Loads face-api.js TinyFaceDetector
 * model and responds to DETECT_FACES messages from the service worker.
 *
 * FIXES applied:
 *  1. Race condition: wait up to 3s for faceapi global before giving up
 *  2. On model load error, do NOT set modelLoaded=true → allows retry
 *  3. scoreThreshold lowered to 0.2, inputSize set to 416 for real-world screenshots
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
        if (modelLoaded || !modelLoading) { clearInterval(check); resolve(); }
      }, 100);
    });
    return;
  }

  modelLoading = true;
  try {
    // FIX 1: Wait up to 3s for faceapi global to become available.
    // The <script src="face-api.min.js"> tag loads asynchronously — if
    // ensureModel() is called while that script is still parsing, faceapi
    // will not yet be defined. Previously the code silently returned and
    // set modelLoaded=true (meaning 0 faces were returned forever).
    let waited = 0;
    while (typeof faceapi === 'undefined' && waited < 3000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }

    if (typeof faceapi === 'undefined') {
      console.error('[FaceDetector] face-api.js global never became available after 3s. Model weights will not load.');
      modelLoading = false;
      // Do NOT set modelLoaded=true — this allows a retry on the next detection call.
      return;
    }

    console.log('[FaceDetector] face-api.js global ready. Loading TinyFaceDetector weights from:', MODELS_URL + '/tiny_face_detector');
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL + '/tiny_face_detector');
    modelLoaded = true;
    console.log('[FaceDetector] ✅ TinyFaceDetector model loaded successfully');
  } catch (e) {
    console.error('[FaceDetector] ❌ Model load failed:', e);
    // FIX 2: Do NOT mark as loaded on failure — allow next call to retry.
    modelLoaded = false;
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
        console.warn('[FaceDetector] Model not ready — returning 0 faces');
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

      console.log(`[FaceDetector] Running detection on ${canvas.width}x${canvas.height} screenshot...`);

      // FIX 3: Lower scoreThreshold from 0.4 → 0.2 for real-world web screenshots
      // where faces are smaller, side-lit, or lower-resolution.
      // inputSize: 416 is the recommended input size for TinyFaceDetector.
      const detections = await faceapi.detectAllFaces(
        canvas,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.2 })
      );

      const faces = detections.map(d => ({
        x: d.box.x,
        y: d.box.y,
        w: d.box.width,
        h: d.box.height,
        score: d.score,
      }));

      console.log(`[FaceDetector] ✅ Found ${faces.length} face(s):`, faces.map(f => `(${Math.round(f.x)},${Math.round(f.y)}) ${Math.round(f.w)}x${Math.round(f.h)} score=${f.score.toFixed(2)}`));
      sendResponse({ faces });
    } catch (e) {
      console.error('[FaceDetector] Detection error:', e);
      sendResponse({ faces: [], error: e.message });
    }
  })();

  return true; // keep message channel open for async response
});

// Pre-load model on startup (runs when offscreen doc opens)
console.log('[FaceDetector] Offscreen worker starting — pre-loading model...');
ensureModel();
