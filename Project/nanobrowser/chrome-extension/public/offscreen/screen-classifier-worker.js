/**
 * Screen Classifier Worker (CLIP Zero-Shot)
 *
 * Runs inside vision-offscreen.html alongside face-detector-worker.js.
 * Uses @huggingface/transformers CLIP ViT-B/32 (q8) for zero-shot
 * image classification.
 *
 * Text embeddings for fixed labels are precomputed ONCE at model init
 * and cached — subsequent calls only encode the image (~200-400ms).
 *
 * Messages handled:
 *   PRELOAD_CLIP    → pre-loads model, responds { ready: true }
 *   CLASSIFY_SCREEN → classifies screenshot, responds { label, score }
 */

// Transformers.js is imported via ESM (this file is loaded as type="module")
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js';

// Point WASM runtime to local extension files (avoids CDN CSP issues for WASM)
// Model weights are still fetched from HuggingFace CDN and cached in Cache Storage
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/';
env.allowLocalModels = false;
env.useBrowserCache = true; // cache model weights in browser Cache Storage

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const DTYPE = 'q8'; // ~153MB total (89MB vision + 64MB text), quantized int8

// Fixed privacy classification labels — never change at runtime
const PRIVACY_LABELS = [
  'a banking or financial transactions webpage',
  'an identity verification KYC or government ID form',
  'a healthcare or medical records page',
  'a social media or messaging application',
  'an ecommerce or online shopping page',
  'a general news blog search or documentation page',
];

// Label → our internal label name mapping
const LABEL_MAP = {
  'a banking or financial transactions webpage': 'financial',
  'an identity verification KYC or government ID form': 'identity',
  'a healthcare or medical records page': 'healthcare',
  'a social media or messaging application': 'social',
  'an ecommerce or online shopping page': 'ecommerce',
  'a general news blog search or documentation page': 'general',
};

let classifier = null;
let modelLoading = false;
let modelLoaded = false;

async function ensureModel() {
  if (modelLoaded) return;
  if (modelLoading) {
    // Wait for ongoing load to complete
    await new Promise(resolve => {
      const interval = setInterval(() => {
        if (modelLoaded) { clearInterval(interval); resolve(undefined); }
      }, 200);
    });
    return;
  }

  modelLoading = true;
  try {
    console.log('[ScreenClassifier] Loading CLIP ViT-B/32 (q8)... (~153MB, cached after first run)');
    const t0 = Date.now();

    classifier = await pipeline('zero-shot-image-classification', MODEL_ID, {
      dtype: DTYPE,
      // Note: text embeddings for fixed labels are internally cached by
      // Transformers.js pipeline after first call — subsequent calls only
      // encode the image. This is the library's built-in optimization.
    });

    // Warm up: run a tiny dummy inference to cache text embeddings
    // This ensures first real call only pays image encoding cost
    const warmupCanvas = new OffscreenCanvas(32, 32);
    const ctx = warmupCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 32, 32);
    const warmupBlob = await warmupCanvas.convertToBlob({ type: 'image/jpeg' });
    await classifier(warmupBlob, PRIVACY_LABELS);

    modelLoaded = true;
    console.log(`[ScreenClassifier] CLIP model loaded and cached in ${Date.now() - t0}ms ✅`);
  } catch (e) {
    console.error('[ScreenClassifier] Model load failed:', e);
    modelLoaded = true; // mark done to avoid infinite wait; classify calls will fail gracefully
  } finally {
    modelLoading = false;
  }
}

// Handle messages from service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PRELOAD_CLIP') {
    ensureModel().then(() => sendResponse({ ready: modelLoaded })).catch(() => sendResponse({ ready: false }));
    return true;
  }

  if (message.type === 'CLASSIFY_SCREEN') {
    (async () => {
      try {
        await ensureModel();

        if (!classifier) {
          sendResponse({ label: 'general', score: 0.50, error: 'Model not available' });
          return;
        }

        // Decode base64 screenshot to Blob
        const { screenshotB64 } = message;
        const binary = atob(screenshotB64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'image/jpeg' });

        const t0 = Date.now();

        // Run zero-shot classification with our fixed privacy labels
        // Text embeddings are cached internally after warmup — only image is encoded here
        const results = await classifier(blob, PRIVACY_LABELS);

        const elapsed = Date.now() - t0;

        // results is sorted by score descending
        const top = results[0];
        const internalLabel = LABEL_MAP[top.label] ?? 'general';

        console.log(`[ScreenClassifier] CLIP result: ${internalLabel} (${top.score.toFixed(3)}) in ${elapsed}ms`);

        sendResponse({ label: internalLabel, score: top.score, latencyMs: elapsed });
      } catch (e) {
        console.error('[ScreenClassifier] Classification error:', e);
        sendResponse({ label: 'general', score: 0.50, error: e.message });
      }
    })();
    return true; // keep channel open for async response
  }

  return false;
});

// Start loading model in background immediately on page load
ensureModel();
