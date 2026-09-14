# ShieldBrowse — Complete Phased Implementation Plan

> **Project:** Privacy-Preserving Browser Vision Agent  
> **Competition:** Smart India Hackathon (SIH)  
> **Last Updated:** 14 September 2026

---

## Problem Statement

Build a **privacy-preserving browser vision agent** that:
1. Runs a **local vision model** to read screen state
2. **Detects and redacts PII** visually (faces, passwords, Aadhaar, PAN, credit cards, etc.)
3. Sends **only sanitized** visual context to a server-side VLM
4. Server returns **actionable UI commands**, client executes them

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Fully implemented & working |
| 🔄 | Partially implemented / needs wiring |
| 🔲 | Not yet started |

---

# PHASE 1 — Foundation & Base Agent
> **Status: ✅ COMPLETE**

Everything in this phase was inherited from the nanobrowser base and extended for ShieldBrowse.

| Task | File / Location | Status |
|------|----------------|--------|
| Chrome Extension base (MV3, TypeScript + React) | `chrome-extension/` | ✅ Done |
| Background Service Worker | `chrome-extension/src/background/index.ts` | ✅ Done |
| Agent executor core loop | `chrome-extension/src/background/agent/executor.ts` | ✅ Done |
| Action builder (DOM actions) | `chrome-extension/src/background/agent/actions/builder.ts` | ✅ Done |
| Action schemas | `chrome-extension/src/background/agent/actions/schemas.ts` | ✅ Done |
| DOM tree builder | `chrome-extension/public/buildDomTree.js` | ✅ Done |
| Ollama + Qwen2.5:7b (local text LLM) | Ollama service on localhost | ✅ Done |
| Text-level PII detection + redaction | `chrome-extension/src/background/services/guardrails/` | ✅ Done |
| Privacy Shield UI + Audit Log | Side panel React components | ✅ Done |
| Screenshot capture via Puppeteer | `page.takeScreenshot()` → base64 JPEG | ✅ Done |
| i18n / locales | `packages/i18n/` | ✅ Done |
| Analytics service | `chrome-extension/src/background/services/analytics.ts` | ✅ Done |
| Speech-to-text service | `chrome-extension/src/background/services/speechToText.ts` | ✅ Done |

---

# PHASE 2 — Vision Pipeline (Client-Side)
> **Status: ✅ COMPLETE**

All five vision modules have been created inside the extension.

---

## Module 1 — Visual PII Detector
**Location:** `chrome-extension/src/background/vision/`

| Task | File | Status |
|------|------|--------|
| face-api.js TinyFaceDetector model weights | `public/models/tiny_face_detector/tiny_face_detector_model-shard1` (193 KB) | ✅ Done |
| Weights manifest | `public/models/tiny_face_detector/tiny_face_detector_model-weights_manifest.json` | ✅ Done |
| Face detector wrapper | `vision/faceDetector.ts` | ✅ Done |
| DOM bounding box extractor | `vision/domBboxExtractor.ts` | ✅ Done |
| Heuristic PII classifier (Aadhaar, PAN, CC, phone, email) | `vision/heuristicClassifier.ts` | ✅ Done |
| Screen classifier (context-aware page type detection) | `vision/screenClassifier.ts` | ✅ Done |
| Page visual scan (full-page PII orchestration) | `vision/pageVisualScan.ts` | ✅ Done |
| Combined visual PII detector (wraps all strategies) | `vision/visualPiiDetector.ts` | ✅ Done |

---

## Module 2 — Visual Redactor
**Location:** `chrome-extension/src/background/vision/`

| Task | File | Status |
|------|------|--------|
| OffscreenCanvas-based redactor (black-box + pixelate) | `vision/visualRedactor.ts` | ✅ Done |
| Screenshot sanitizer (combines redactor output) | `vision/sanitizeScreenshot.ts` | ✅ Done |

---

## Module 3 — Pipeline Orchestrator (Client)
**Location:** `chrome-extension/src/background/vision/`

| Task | File | Status |
|------|------|--------|
| Vision pipeline (screenshot → detect → redact → send → execute) | `vision/pipeline.ts` (16 KB) | ✅ Done |
| Barrel export for all vision modules | `vision/index.ts` | ✅ Done |

---

## Module 4 — Vision Action Executor
**Location:** `chrome-extension/src/background/agent/actions/`

| Task | File | Status |
|------|------|--------|
| Vision action executor (click/scroll/type/navigate from VLM response) | `actions/visionActionExecutor.ts` | ✅ Done |

---

## Module 5 — Server Client
**Location:** `chrome-extension/src/background/services/`

| Task | File | Status |
|------|------|--------|
| Server fetch wrapper (POST sanitized screenshot to FastAPI) | `services/serverClient.ts` | ✅ Done |

---

# PHASE 3 — ShieldBrowse Server (FastAPI + VLM)
> **Status: ✅ COMPLETE**

Full FastAPI server with Ollama-based VLM integration.

| Task | File | Status |
|------|------|--------|
| FastAPI app entry point | `server/main.py` | ✅ Done |
| POST /agent/process route | `server/routes/agent.py` | ✅ Done |
| GET /health route | `server/routes/health.py` | ✅ Done |
| VLM client (Ollama → llava:7b / moondream) | `server/services/vlm_client.py` | ✅ Done |
| Action parser (LLM output → structured JSON actions) | `server/services/action_parser.py` | ✅ Done |
| Image utilities (base64 decode, resize, validate) | `server/services/image_utils.py` | ✅ Done |
| Pydantic request/response schemas | `server/models/schemas.py` | ✅ Done |
| Python dependencies | `server/requirements.txt` | ✅ Done |
| One-click Windows launcher | `server/start.bat` | ✅ Done |
| Package `__init__.py` files | all server sub-packages | ✅ Done |

**API Contract (implemented):**

```json
POST /agent/process
Request:
{
  "screenshot": "<base64 sanitized PNG>",
  "dom_context": "<redacted DOM text>",
  "task": "<user's task>",
  "redaction_report": { "faces_redacted": 2, "pii_fields_redacted": 3, "total_regions": 5 }
}

Response:
{
  "actions": [
    {"type": "click", "selector": "#submit-btn", "description": "Click submit"},
    {"type": "scroll", "direction": "down", "amount": 300}
  ],
  "reasoning": "I can see a form...",
  "model_used": "llava:7b"
}
```

---

# PHASE 4 — Integration, Wiring & Side Panel UI
> **Status: 🔄 IN PROGRESS — Priority Now**

Individual modules are built; end-to-end wiring and UI need completion.

---

## 4A — Wire Vision Pipeline into Executor

| Task | File | Status |
|------|------|--------|
| Import VisionPipeline in background index | `chrome-extension/src/background/index.ts` | ✅ Done |
| Wire `VisionPipeline.run(task)` call inside `executor.ts` | `agent/executor.ts` | 🔄 Partial — needs final trigger hookup |
| End-to-end error handling in pipeline | `vision/pipeline.ts` | 🔄 Needs review |
| Fallback: if server unreachable → fall back to text LLM | `vision/pipeline.ts` | 🔲 Not done |

---

## 4B — Side Panel UI Overhaul (Module 5)

| Task | File / Location | Status |
|------|----------------|--------|
| Vision Mode toggle in chat input area | Side panel React components | 🔲 Not done |
| Redaction badge (`N regions redacted` per task step) | Side panel | 🔲 Not done |
| Action trace panel (list of executed VLM-suggested actions) | Side panel | 🔲 Not done |
| Server status indicator (green/red dot — FastAPI reachable?) | Side panel | 🔲 Not done |
| Branding update (ShieldBrowse name, logo, color theme) | Side panel + manifest | 🔲 Not done |

---

## 4C — VLM Backend Setup

> [!NOTE]
> **OpenRouter is the active VLM backend** — `vlm_client.py` already uses OpenRouter (llama-3.2-11b-vision, free tier). **Ollama is NOT required.** Only set up Ollama if you want to run fully offline without an API key.

### Option A — OpenRouter (Current Default ✅ — Use This)

| Task | How | Status |
|------|-----|--------|
| Get a free OpenRouter API key | [openrouter.ai](https://openrouter.ai) → Sign up → Copy API key | 🔲 Confirm key is set |
| Set the key in server | Create `server/.env` file: `OPENROUTER_API_KEY=your_key_here` | 🔲 Confirm done |
| Verify VLM is working | `GET http://localhost:8000/health` → should return `{"status": "ok"}` | 🔲 Confirm done |

**Model in use:** `meta-llama/llama-3.2-11b-vision-instruct:free` (free tier, no cost, multimodal)

### Option B — Ollama (Offline Fallback, Optional Only)

| Task | Command | Status |
|------|---------|--------|
| Pull llava:7b (if going offline) | `ollama pull llava:7b` | 🔲 Optional |
| Pull moondream (lighter, faster) | `ollama pull moondream` | 🔲 Optional |

---

# PHASE 5 — Security, Quality & Polish
> **Status: 🔲 NOT STARTED**

---

## 5A — Security Hardening

| Task | Details | Status |
|------|---------|--------|
| Rate limiting on `/agent/process` | Prevent abuse if server is exposed | 🔲 |
| Input validation — screenshot size cap | Reject payloads > 5 MB | 🔲 |
| CORS restriction | Lock to `chrome-extension://<id>` origin only | 🔲 |
| Audit log persistence | Persist redaction audit log to IndexedDB | 🔲 |

---

## 5B — PII Detection Improvements

| Task | Details | Status |
|------|---------|--------|
| Tesseract.js OCR integration | Detect Aadhaar/PAN visually in screenshot image (not just DOM) | 🔲 |
| Regex hardening for Indian ID formats | More precise Aadhaar (12-digit groups), PAN (AAAAA9999A format) | 🔲 |
| Confidence threshold tuning | Reject face bbox if `score < 0.7` | 🔲 |

---

## 5C — Performance Optimization

| Task | Details | Status |
|------|---------|--------|
| face-api model pre-warm on extension startup | Load once → zero latency on first task | 🔲 |
| Screenshot compression before upload | Scale down to max 1280px width before sending to server | 🔲 |
| Pipeline parallelization | Run face detection + DOM bbox in parallel | 🔲 |

---

# PHASE 6 — Testing & Evaluation
> **Status: 🔲 NOT STARTED**

---

## 6A — Unit Tests

| Test | Target | Status |
|------|--------|--------|
| `heuristicClassifier.test.ts` — Aadhaar/PAN regex | `heuristicClassifier.ts` | 🔲 |
| `visualRedactor.test.ts` — black-box coverage | `visualRedactor.ts` | 🔲 |
| `action_parser_test.py` — LLM output parsing | `server/services/action_parser.py` | 🔲 |
| `image_utils_test.py` — base64 decode + resize | `server/services/image_utils.py` | 🔲 |

---

## 6B — End-to-End Test Scenarios

| Scenario | Target Modules | Status |
|----------|---------------|--------|
| Open bank login page → detect password → redact → VLM → click login | M1 + M2 + M3 + Server + M4 | 🔲 |
| Open page with profile photo → face detected → pixelated → VLM sees blurred image | M1 + M2 + Server | 🔲 |
| Server offline → fallback to text-LLM gracefully | `pipeline.ts` fallback path | 🔲 |
| Aadhaar number on page → detected → black box redaction | heuristicClassifier + visualRedactor | 🔲 |

---

## 6C — Evaluation Metrics Coverage

| Criterion | Weight | Module | Target |
|-----------|--------|--------|--------|
| Accuracy of visual context from screen | 25% | M1 + M2 (screenshot + redacted image to VLM) | High |
| Recall/Precision for PII detection | 20% | M1 (face-api + DOM bbox + Heuristic + OCR) | High |
| Precision of redaction | 20% | M2 (Canvas black-box + pixelate) | High |
| Client-side resource utilization | 20% | TinyFaceDetector (193 KB, WebGL) | Good |
| End-to-end latency | 15% | Parallelized pipeline, single server round-trip | Good |

---

# PHASE 7 — Deployment & Demo
> **Status: 🔲 NOT STARTED**

| Task | Details | Status |
|------|---------|--------|
| Build Chrome extension | `pnpm build` → produces `dist/` | 🔲 |
| Load unpacked extension in Chrome | `chrome://extensions` → Load unpacked → select `dist/` | 🔲 |
| Start FastAPI server locally | Run `server/start.bat` | 🔲 |
| Deploy server to cloud (optional) | Vercel / Railway via `vercel.json` | 🔲 |
| Pull Ollama VLM model | `ollama pull llava:7b` or `ollama pull moondream` | 🔲 |
| Demo script / walkthrough recording | End-to-end video for judges | 🔲 |
| Landing page polish | `Project/landing/` | 🔲 |

---

## Full System Architecture (Reference)

```
┌─────────────────────────────────────────────────────────────┐
│                  CHROME EXTENSION (Client)                  │
│                                                             │
│  Background Service Worker                                  │
│  page.takeScreenshot()  ─────────────────────►  base64 JPEG │
│       │                                                     │
│       ▼                                                     │
│  [MODULE 1] Visual PII Detector ✅                          │
│  faceDetector + domBboxExtractor + heuristicClassifier      │
│  → [{x,y,w,h, type, confidence}] bounding boxes            │
│       │                                                     │
│       ▼                                                     │
│  [MODULE 2] Visual Redactor ✅                              │
│  OffscreenCanvas → black-box / pixelate sensitive regions   │
│  → sanitized base64 PNG + redaction report                  │
│       │                                                     │
│       ▼                                                     │
│  [serverClient.ts] ✅                                       │
│  POST /agent/process with sanitized screenshot              │
└───────┼─────────────────────────────────────────────────────┘
        │ HTTPS POST (sanitized image only — PII never leaves client)
        ▼
┌─────────────────────────────────────────────────────────────┐
│         SHIELDBROWSE SERVER (FastAPI) ✅                    │
│                                                             │
│  POST /agent/process                                        │
│  → image_utils: decode + validate                           │
│  → vlm_client: Ollama llava:7b / moondream                  │
│  → action_parser: LLM output → structured JSON actions      │
│  → { actions: [...], reasoning, model_used }                │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│                  CHROME EXTENSION (Client)                  │
│                                                             │
│  [MODULE 4] visionActionExecutor.ts ✅                      │
│  click / scroll / type / navigate via Puppeteer/CDP         │
│                                                             │
│  [Side Panel UI] 🔲  ← NEXT TO BUILD                       │
│  Vision Mode toggle, Redaction badge, Action trace          │
│  Server status dot                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 1** | Foundation & Base Agent | ✅ Complete |
| **Phase 2** | Vision Pipeline — Client Modules | ✅ Complete |
| **Phase 3** | ShieldBrowse FastAPI Server | ✅ Complete |
| **Phase 4** | Integration, Wiring & Side Panel UI | 🔄 In Progress |
| **Phase 5** | Security, Quality & Polish | 🔲 Not Started |
| **Phase 6** | Testing & Evaluation | 🔲 Not Started |
| **Phase 7** | Deployment & Demo | 🔲 Not Started |

---

> [!IMPORTANT]
> **Next Immediate Priority → Phase 4:**
> 1. Finish wiring `VisionPipeline.run()` into `executor.ts`
> 2. Add server fallback logic in `pipeline.ts`
> 3. Pull `llava:7b` or `moondream` into Ollama
> 4. Overhaul Side Panel UI (Vision Mode toggle, redaction badge, action trace, server status dot)
> 5. Run first end-to-end test

> [!TIP]
> For Phase 5 PII improvements — **Tesseract.js OCR** is the highest-impact addition.
> It catches Aadhaar/PAN numbers that appear as image text in screenshots (not in DOM).










# ShieldBrowse — Complete Implementation Plan

> **Status as of: 13 Sep 2026**  
> This plan separates what is already built, what must be completed for the SIH hackathon demo, and what is explicitly deferred to future scope.

---

## 🟢 Already Implemented (DO NOT RE-IMPLEMENT)

These are production-ready files — leave them alone unless fixing a bug.

### Chrome Extension — Background Vision Pipeline
| File | What it does | Status |
|---|---|:---:|
| `vision/pipeline.ts` | Orchestrator — runs 8-step vision pipeline | ✅ DONE |
| `vision/screenClassifier.ts` | Heuristic → CLIP two-pass screen classification | ✅ DONE |
| `vision/heuristicClassifier.ts` | Fast DOM-based page type detection (<5ms) | ✅ DONE |
| `vision/visualPiiDetector.ts` | Merges face bboxes + DOM bboxes into detection report | ✅ DONE |
| `vision/visualRedactor.ts` | Applies black-fill rectangles over detected PII regions | ✅ DONE |
| `vision/faceDetector.ts` | Face detection via offscreen document | ✅ DONE |
| `vision/domBboxExtractor.ts` | Extracts sensitive element bounding boxes from DOM | ✅ DONE |
| `vision/sanitizeScreenshot.ts` | Canvas-based pixel-level redaction | ✅ DONE |
| `vision/pageVisualScan.ts` | High-level page scan trigger | ✅ DONE |
| `privacy/piiDetector.ts` | Text-level PII pattern matcher (regex + DOM) | ✅ DONE |
| `privacy/piiRedactor.ts` | Text redaction before LLM ingestion | ✅ DONE |
| `privacy/auditLog.ts` | Local audit log of redaction events | ✅ DONE |

### Server (FastAPI + Python)
| File | What it does | Status |
|---|---|:---:|
| `server/main.py` | FastAPI app, CORS, route registration | ✅ DONE |
| `server/routes/agent.py` | `POST /agent/process` — receives sanitized frame → VLM → actions | ✅ DONE |
| `server/routes/health.py` | `GET /health` endpoint | ✅ DONE |
| `server/services/vlm_client.py` | **OpenRouter** VLM client (llama-3.2-11b-vision, free tier) | ✅ DONE (just fixed) |
| `server/services/action_parser.py` | Parses VLM text response into action list | ✅ DONE |
| `server/services/image_utils.py` | Screenshot validation + resize | ✅ DONE |

### Side Panel UI (Partial)
| File | What it does | Status |
|---|---|:---:|
| `SidePanel.tsx` | Main chat interface, task input, history | ✅ DONE |
| `components/ChatInput.tsx` | Task input with voice recording | ✅ DONE |
| `components/MessageList.tsx` | Chat message display | ✅ DONE |
| `components/PrivacyShieldModal.tsx` | Modal shell (renders `redactedCount` + `detectedTypes`) | ✅ DONE (shell only — not wired to pipeline yet) |

---

## 🔴 Missing — Must Build for Hackathon Demo

These are the critical gaps that must be finished. Prioritized by impact on evaluation score.

---

### TASK 0.5 — Privacy Shadow: Semantic Token Rendering (Visual Redactor Upgrade)
**Priority: HIGH | Effort: Tiny (~10 lines) | Eval Impact: VLM accuracy, novel demo story**

> [!IMPORTANT]
> **The Core Upgrade:** Instead of rendering plain black boxes over text PII fields, overlay a semantic label that tells the VLM *what kind of data was there*, without revealing the actual value. Faces and images stay as pure black/pixelated blobs — no labels needed there.

**Two-tier redaction strategy (final design):**

| Region Type | What VLM Sees | Why |
|---|---|---|
| Password / OTP / Aadhaar / PAN / Credit Card | Black background + `<CREDENTIAL>` / `<OTP>` / `<IDENTITY_ID>` / `<CARD_NUMBER>` label | VLM understands field role, can plan correctly |
| Face / profile photo / biometric image | Pure black box or pixelated blur (current) | No semantic label needed — VLM just knows it was redacted |

**Demo pitch:** *"The AI never sees your Aadhaar number — it sees `<IDENTITY_ID>`. The real value stays on your device. The AI gets just enough context to do its job."*

**What to change in `visualRedactor.ts`:**
```typescript
// Current (plain black box for all types):
ctx.fillStyle = '#000000';
ctx.fillRect(x, y, w, h);

// NEW — for text PII fields (password, aadhaar, pan, otp, card):
ctx.fillStyle = '#000000';
ctx.fillRect(x, y, w, h);               // black background (same as before)
ctx.fillStyle = '#00E5A0';              // green label text — visible, legible
ctx.font = `bold ${Math.min(h * 0.55, 14)}px monospace`;
ctx.fillText(`<${tokenLabel}>`, x + 4, y + h * 0.68);

// Faces / images — UNCHANGED (pure black / pixelate blur):
ctx.fillStyle = '#000000';
ctx.fillRect(x, y, w, h);              // no label
```

**Token label mapping:**
```
input[type="password"]       → <CREDENTIAL>
aadhaar / uid fields         → <IDENTITY_ID>
pan fields                   → <TAX_ID>
otp fields                   → <OTP>
credit/debit card fields     → <CARD_NUMBER>
cvv / expiry                 → <CARD_SECURITY>
face / biometric image       → (no label — black/blur only)
```

**Files to edit:**
- `chrome-extension/src/background/vision/visualRedactor.ts` — split rendering logic by `type` (text PII → token label, face/image → plain black)
- `chrome-extension/src/background/vision/visualPiiDetector.ts` — ensure each bbox carries a `tokenLabel` field alongside `type`

---

### TASK 0.75 — Local Secure Vault + Token Resolver
**Priority: CRITICAL | Effort: ~60 lines | Eval Impact: Core privacy architecture — makes the whole token system actually work**

> [!IMPORTANT]
> **The Missing Link:** Task 0.5 makes the AI *see* `<IDENTITY_ID>` instead of the real Aadhaar. But when the AI says "type `<IDENTITY_ID>` in the form field" — who does the actual typing with the real value? This task answers that. Without it, form-filling is completely broken.

**Core Idea:**
The browser extension maintains a **tab-scoped, in-memory vault** that maps semantic tokens → real PII values. This vault is created **locally** during page scan, and **never leaves the device**. Before executing any AI-generated action, a Token Resolver intercepts it, substitutes the real value, and only then performs the DOM interaction.

```
                    ┌──────────────────────────────────────────┐
                    │        LOCAL SECURE VAULT                │
                    │    (chrome.storage.session — RAM only)   │
                    │                                          │
  Page Scan ───────►│  <IDENTITY_ID>  → "123456789012"        │
  (DOM + heuristic) │  <CREDENTIAL>   → "myP@ssword!"         │
                    │  <OTP>          → "847291"               │
                    │  <CARD_NUMBER>  → "4111 1111 1111 1111"  │
                    └──────────────┬───────────────────────────┘
                                   │
                                   │ resolve() — LOCAL ONLY
                                   ▼
  AI Action arrives:         Token Resolver
  {                     ─────────────────────►  {
    action: "type",                               action: "type",
    value: "<IDENTITY_ID>"                        value: "123456789012"  ← real
  }                                             }
                                                        │
                                                        ▼
                                               Actual DOM typing
                                               (user's real data filled)
```

**What to build:**

**`chrome-extension/src/background/privacy/secureVault.ts`** *(NEW)*
```typescript
// Tab-scoped vault — cleared automatically when tab closes
// Keys are semantic token strings, values are real PII

export interface VaultEntry {
  token: string;        // e.g. "<IDENTITY_ID>"
  realValue: string;    // e.g. "123456789012"
  fieldSelector: string; // e.g. "input[name='aadhaar']"
  type: string;         // e.g. "IDENTITY_ID"
}

export class SecureVault {
  private static store = new Map<string, string>();

  static populate(entries: VaultEntry[]): void {
    this.store.clear();
    for (const e of entries) {
      this.store.set(e.token, e.realValue);
    }
  }

  static resolve(token: string): string {
    return this.store.get(token) ?? token; // fallback: return token as-is
  }

  static clear(): void {
    this.store.clear();
  }
}
```

**`chrome-extension/src/background/privacy/tokenResolver.ts`** *(NEW)*
```typescript
import { SecureVault } from './secureVault';

const TOKEN_PATTERN = /^<[A-Z_]+>$/;

export function resolveActionValue(value: string): string {
  if (TOKEN_PATTERN.test(value.trim())) {
    return SecureVault.resolve(value.trim());
  }
  return value; // not a token — pass through
}

export function resolveAction(action: { value?: string; [key: string]: unknown }) {
  if (action.value && typeof action.value === 'string') {
    action.value = resolveActionValue(action.value);
  }
  return action;
}
```

**How the vault gets populated (in `pipeline.ts` / `domBboxExtractor.ts`):**
```typescript
// After DOM bbox extraction, collect real values BEFORE masking them
const vaultEntries = detectedFields.map(field => ({
  token: `<${field.tokenLabel}>`,
  realValue: field.element.value,  // actual DOM input value
  fieldSelector: field.selector,
  type: field.tokenLabel
}));

SecureVault.populate(vaultEntries);
// Now proceed with masking / sanitization as usual
```

**Integration point in `visionActionExecutor.ts`:**
```typescript
import { resolveAction } from '../privacy/tokenResolver';

// Just before executing any action:
const resolvedAction = resolveAction(rawActionFromVLM);
await executeAction(resolvedAction); // now uses real values
```

**Security properties of this design:**
| Property | Guarantee |
|---|---|
| Vault storage | `Map<>` in service worker memory — never written to disk |
| Scope | Tab-scoped — cleared on tab close or session end |
| Cloud exposure | Zero — AI (OpenRouter) only ever receives tokens |
| Vault access | Only `tokenResolver.ts` can read — no external API |
| Fallback | If token not in vault, original token string passed through (safe — won't fill the field with wrong data) |

**Files to create/edit:**
- `chrome-extension/src/background/privacy/secureVault.ts` **(NEW)**
- `chrome-extension/src/background/privacy/tokenResolver.ts` **(NEW)**
- `chrome-extension/src/background/vision/pipeline.ts` — populate vault after DOM extraction, before redaction
- `chrome-extension/src/background/agent/visionActionExecutor.ts` — call `resolveAction()` before execution

---

### TASK 1 — Wire Vision Pipeline → SidePanel UI
**Priority: CRITICAL | Eval Impact: 25% + 20% marks | Demo Risk: HIGHEST**

> [!IMPORTANT]
> This is the #1 priority. The entire backend pipeline works end-to-end but the UI never shows its output. Judges see a blank screen during the demo. Fix this first before any security features.

The `VisionPipeline` and `PrivacyShieldModal` exist but are completely disconnected. The UI never shows live redaction stats.

**What to build:**
1. In `background/index.ts`: After a vision pipeline run, broadcast a `VISION_PIPELINE_RESULT` message via the existing port.
2. In `SidePanel.tsx`: Listen for `VISION_PIPELINE_RESULT` and update `redactedCount`, `detectedTypes`, and pipeline status.
3. In `PrivacyShieldModal.tsx`: Add a live stats view — show per-type PII count (faces, passwords, PAN, Aadhaar, etc), last scan timestamp, and model inference time.

**Files to edit:**
- `chrome-extension/src/background/index.ts`
- `pages/side-panel/src/SidePanel.tsx`
- `pages/side-panel/src/components/PrivacyShieldModal.tsx`

---

### TASK 2 — Privacy Shield Live Status Indicator in SidePanel Header
**Priority: HIGH | Eval Impact: Visual demo credibility**

The FiShield icon exists in the SidePanel header but is purely decorative. It should reflect the real pipeline state.

**What to build:**
- A green pulsing dot when the pipeline is active/scanning.
- A badge counter showing total PII items redacted in this session.
- A single click on the shield icon opens the `PrivacyShieldModal`.

**Files to edit:**
- `pages/side-panel/src/SidePanel.tsx`
- `pages/side-panel/src/SidePanel.css`

---

### TASK 3 — Prompt Injection Stripping Pass (IPI Defense — Angle A)
**Priority: HIGH | Eval Impact: Security/Robustness narrative, unique claim | Status: ✅ COMPLETE**

This is the most powerful zero-cost differentiator for AI browser agents.

**What was built:**
- `chrome-extension/src/background/privacy/ipiSanitizer.ts`:
  - Strips invisible zero-width Unicode characters (`\u200B-\u200D\uFEFF\u2060`, BiDi overrides) used to bypass tokenizers.
  - Detects and defangs prompt injection patterns (`ignore previous instructions`, `you are now an evil agent`, `system prompt:`, `developer mode activated`, LLM control tokens `[INST]`, `<|im_start|>`, `<<SYS>>`).
  - Replaces malicious injection substrings with `[BLOCKED_INJECTION]`.
  - Wraps all page-derived text in `<UNTRUSTED_PAGE>...</UNTRUSTED_PAGE>` boundary tags.
- `chrome-extension/src/background/privacy/piiRedactor.ts`:
  - Integrated `ipiSanitizer` into `redactText` and exported `redactDomContext`.
- `chrome-extension/src/background/vision/pipeline.ts`:
  - Step 7 runs `redactDomContext(rawDomContext)` and logs detected IPI patterns before sending to server.
- `chrome-extension/src/background/privacy/__tests__/ipiSanitizer.test.ts`:
  - 13 comprehensive unit tests covering all bypass attacks, all passing (74/74 passing overall).

---

### TASK 3B — Live Action Guardian (Pre-Execution Verification & Drift Detection)
**Priority: CRITICAL / HIGH | Eval Impact: Real-Time Action Safety, Unique Innovation Differentiator | Status: ✅ COMPLETE**

> [!IMPORTANT]
> **Key Differentiator for SIH:** “ShieldBrowse doesn't just secure what the AI sees or what it plans to do. It continuously verifies what the AI is actually doing in real time.”
> AI browser agents must NEVER be trusted to execute high-impact actions blindly in dynamic environments where prices, quantities, and balances change on the fly.

**What to build:**
- New file: `chrome-extension/src/background/agent/actions/liveActionGuardian.ts`
- **Three-way comparison check** right before executing any actionable command (in `visionActionExecutor.ts`):
  1. **User's Original Intent:** Approved target symbol, approved max price, approved quantity, destination account.
  2. **Live Browser State:** Immediate live DOM inspection of target elements/inputs (`#quantity`, `#price`, `#account`, buttons).
  3. **Agent's Next Action:** Target selector, values to be typed/clicked.
- **Drift Detection & Interception:**
  - If a drift is detected (e.g. quantity changed from 10 to 100, price spiked above limit, or destination changed):
    - **PAUSE** execution immediately.
    - Emit `ACTION_GUARDIAN_ALERT` to `SidePanel.tsx` with specific drift details.
    - Require user confirmation or auto-block before the click reaches the page.

**Files to create/edit:**
- `chrome-extension/src/background/agent/actions/liveActionGuardian.ts` **(NEW)**
- `chrome-extension/src/background/agent/actions/visionActionExecutor.ts` — integrate Guardian verification hook before dispatching clicks/inputs
- `pages/side-panel/src/SidePanel.tsx` — render Live Guardian confirmation / drift alert dialog
- `Project/nanobrowser/demo-pii-page.html` — include a dynamic order/transaction drift test section

---

### TASK 4 — Cryptographic Egress Attestation (Angle B — Signed Manifest)
**Priority: HIGH | Eval Impact: Unique technical claim, audit trail**

> [!WARNING]
> **Honest pitch language:** This generates a cryptographic signature for audit trail purposes. For the hackathon demo, the server receives and logs the manifest but does NOT perform full ECDSA verification (that requires a pub key exchange protocol — deferred to future scope). In your demo, say: *"We generate a signed redaction manifest per frame for a tamper-evident audit trail; full server-side cryptographic verification is on our roadmap."* Do NOT claim the server rejects tampered frames — you cannot demonstrate that live.

**What to build:**
- New file: `chrome-extension/src/background/privacy/egressSigner.ts`
- Uses `crypto.subtle.generateKey` with ECDSA P-256 `{extractable: false}` to create a session signing key.
- For each redacted frame: hash frame bytes (SHA-256), sign the hash + redaction bbox list.
- Produces a `SignedManifest` object: `{ timestamp, nonce, frameHash, regions[], signature }`.
- Server receives and logs the manifest in the `/agent/process` response.

**Files to create/edit:**
- `chrome-extension/src/background/privacy/egressSigner.ts` **(NEW)**
- `chrome-extension/src/background/vision/pipeline.ts` — call signer after redaction step
- `server/models/schemas.py` — add `signed_manifest` optional field to `AgentProcessRequest`
- `server/routes/agent.py` — log manifest receipt

---

### TASK 5 — Server: Manifest Receipt Endpoint
**Priority: MEDIUM | Eval Impact: End-to-end demo completeness**

> [!NOTE]
> This endpoint receives and echoes back the manifest — it does NOT cryptographically verify the ECDSA signature (full verification requires client public key exchange — future scope). This is still valuable for the demo: it proves the manifest travels end-to-end and the server is "manifest-aware."

**What to build:**
- New route: `POST /agent/verify-manifest`
- Accepts the signed manifest JSON.
- Returns `{ received: true, nonce, timestamp, regionCount }` — does not attempt crypto verify.
- Rename the response field clearly: `received` not `verified` — avoids overclaiming.

**Files to create/edit:**
- `server/routes/verify.py` **(NEW)**
- `server/main.py` — register new router

---

### TASK 6 — Demo Test Harness (Critical for Live Demo)
**Priority: HIGH | Eval Impact: Judges need to see it work in 3 minutes**

**What to build:**
- A static `demo.html` page in `Project/nanobrowser/` that contains:
  - A fake "HDFC NetBanking Login" form with Aadhaar number, PAN, password, credit card fields.
  - A "face photo" img element (use a placeholder stock photo or generated face).
  - When the extension runs vision pipeline on this page, it should detect and redact ALL these fields.
  - **Live Action Guardian Simulation Form:** A mock trading/transfer widget where price or quantity drifts in real-time, proving the Guardian blocks/pauses unauthorized drift.
- A `DEMO_SCRIPT.md` with the exact step-by-step judges demo walkthrough.

**Files to create:**
- `Project/nanobrowser/demo-pii-page.html` **(NEW)**
- `Project/nanobrowser/DEMO_SCRIPT.md` **(NEW)**

---

## 🔵 Future Scope (Post-Hackathon / Next Iteration)

These were discussed and are architecturally valid — but too risky to implement in hackathon timeline. Document them in the slide deck as "Roadmap."

| Feature | Why Deferred | Slide Claim |
|---|---|---|
| **OWL-ViT Visual Grounding** | 90MB model, 1.5-3s inference on WebGPU. Risk of freezing demo. Current heuristic bboxes are sufficient for demo. | "Planned: pixel-precise open-vocab grounding (OWL-ViT)" |
| **bert-tiny-NER** | 28MB additional model, needs custom tokenizer wiring in Transformers.js | "Planned: semantic NER layer for contextual PII (names, orgs)" |
| **MobileCLIP-S2 Swap** | Standard CLIP ViT-base works via Transformers.js out of box. MobileCLIP needs custom ONNX export. | "Optimization target: MobileCLIP-S2 (4.8× faster, 2.8× smaller)" |
| **Hardware Security Gateway (Raspberry Pi)** | Separate hardware build — great for innovation slide, not needed for working demo | "Hardware Track: server-side HSM gateway with ATECC608A" |
| **DPDP Act 2023 Compliance Receipt** | Requires legal mapping work | "Roadmap: exportable DPDP Section 8(4) compliance receipt" |
| **Differential Privacy Embedding Noise** | Research-grade, complex calibration | "Research: Laplace mechanism (ε=1) on CLIP embeddings before egress" |
| **True TPM Hardware Attestation** | Needs WebAuthn + platform authenticator — complex browser API | "Full attestation via platform TPM via WebAuthn in v2.0" |
| **WebNN Fallback Dispatch** | Chrome 130+, behind flag, unstable | "v2.0: WebNN dispatch for NPU acceleration on low-end devices" |

---

## 📋 Execution Priority Order

```
WEEK / DAY  TASK                                                OWNER       TIME EST
────────────────────────────────────────────────────────────────────────────────────
Day 1 AM    Task 1: Wire Pipeline → SidePanel (UI)              Dev         4 hrs   ← FIRST: demo visibility
Day 1 PM    Task 2: Live Shield indicator in header             Dev/Design  2 hrs
Day 2 AM    Task 3: IPI Sanitizer (ipiSanitizer.ts)             Dev         2 hrs
Day 2 PM    Task 3B: Live Action Guardian (liveActionGuardian)  Dev         3 hrs   ← KEY INNOVATION DEMO
Day 3 AM    Task 4: Egress Signer (egressSigner.ts)             Dev         3 hrs
Day 3 PM    Task 5: Manifest receipt server endpoint            Dev         1.5 hrs
Day 4 AM    Task 6: demo-pii-page.html + DEMO_SCRIPT.md        All         2.5 hrs
Day 4 PM    Full E2E smoke test + fix bugs                      Dev         Full day
Day 5       Slides update (add Future Scope + Guardian)        PM/Design   Half day
```

---

## 🎯 Final Evaluation Metric Coverage (After All Tasks Done)

| Metric (Weight) | Coverage After Implementation |
|---|:---:|
| **Visual Context Accuracy (25%)** | ScreenClassifier (heuristic + CLIP) ✅ |
| **PII Recall & Precision (20%)** | DOM bboxes + Face detect + IPI stripping ✅ |
| **Redaction Precision (20%)** | DOM-coordinate bboxes (tight) ✅ |
| **Client Resource Utilization (20%)** | Single offscreen doc, quantized CLIP ✅ |
| **End-to-End Latency (15%)** | Heuristic fast-path + async pipeline ✅ |
| **Unique Technical Claim** | Signed Manifest (Angle B) + IPI Stripping (Angle A) ✅ |
