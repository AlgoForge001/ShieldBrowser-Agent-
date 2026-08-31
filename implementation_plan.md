# ShieldBrowse — Complete Architecture & Implementation Plan

---

## Problem Statement Recap

> Build a **privacy-preserving browser vision agent** that:
> 1. Runs a local **vision model** to read screen state
> 2. **Detects and redacts** PII visually (faces, passwords, Aadhaar, etc.)
> 3. Sends **only sanitized** visual context to a server-side VLM
> 4. Server returns **actionable UI commands**, client executes them

---

## What Is Already Built

| Component | Status |
|---|---|
| Chrome Extension base (browser agent) | DONE |
| Ollama + Qwen2.5:7b (local LLM) | DONE |
| Text-level PII detection + redaction | DONE |
| `takeScreenshot()` via Puppeteer (base64 JPEG) | EXISTS (unused in privacy flow) |
| Privacy Shield UI + audit log | DONE |

---

## What Is Missing (5 Modules to Build)

```
Module 1 — Visual PII Detector (client-side, in extension)
Module 2 — Visual Redactor (Canvas API, client-side)
Module 3 — ShieldBrowse Server (FastAPI + VLM, server-side)
Module 4 — Action Executor (client-side, in extension)
Module 5 — Side Panel UI Overhaul + Rebranding
```

---

## Full System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  CHROME EXTENSION (Client)                  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Background Service Worker                  │   │
│  │                                                      │   │
│  │  page.takeScreenshot()                               │   │
│  │       │ base64 JPEG                                  │   │
│  │       ▼                                              │   │
│  │  ┌─────────────────────────────────────────┐         │   │
│  │  │  MODULE 1: Visual PII Detector           │         │   │
│  │  │  (face-api.js BlazeFace + DOM BBox)      │         │   │
│  │  │  → Bounding boxes of sensitive regions   │         │   │
│  │  └──────────────────┬──────────────────────┘         │   │
│  │                     │ [{x,y,w,h, type}]              │   │
│  │                     ▼                                │   │
│  │  ┌─────────────────────────────────────────┐         │   │
│  │  │  MODULE 2: Visual Redactor               │         │   │
│  │  │  (Canvas API)                            │         │   │
│  │  │  → Black-box / blur sensitive regions    │         │   │
│  │  │  → Sanitized base64 PNG                  │         │   │
│  │  └──────────────────┬──────────────────────┘         │   │
│  │                     │                                │   │
│  │       ┌─────────────┤                                │   │
│  │       │ sanitized   │ redaction metadata             │   │
│  │       │ screenshot  │ (for audit/eval)               │   │
│  │       ▼             ▼                                │   │
│  │  ┌─────────────────────────────────────────┐         │   │
│  │  │  SERVER CLIENT (fetch POST)              │         │   │
│  │  │  Sends: screenshot + DOM text context   │         │   │
│  │  └──────────────────┬──────────────────────┘         │   │
│  └─────────────────────│────────────────────────────────┘   │
└────────────────────────│────────────────────────────────────┘
                         │ HTTPS POST
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              MODULE 3: SHIELDBROWSE SERVER                  │
│                  Python FastAPI                              │
│                                                             │
│  POST /agent/process                                        │
│       │                                                     │
│       ▼                                                     │
│  Receives sanitized screenshot + text context               │
│       │                                                     │
│       ▼                                                     │
│  Ollama: llava:7b or moondream (multimodal VLM)             │
│       │                                                     │
│       ▼                                                     │
│  Parse response → structured action list                    │
│  [{type:"click", selector:"#submit"},                       │
│   {type:"scroll", direction:"down"},...]                    │
│       │                                                     │
│       ▼                                                     │
│  POST /agent/process → JSON response                        │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  CHROME EXTENSION (Client)                  │
│                                                             │
│  MODULE 4: Action Executor                                  │
│  Receives action list → executes via Puppeteer/CDP          │
│  click / scroll / type / navigate                           │
│                                                             │
│  MODULE 5: Side Panel UI                                    │
│  Shows task progress, PII stats, action trace               │
└─────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Client-Side (Chrome Extension)

| Layer | Technology | Why |
|---|---|---|
| Extension framework | TypeScript + React (existing) | Already in codebase |
| Screenshot capture | `page.takeScreenshot()` (Puppeteer, base64) | Already exists |
| DOM sensitive field detection | `document.querySelectorAll` + `getBoundingClientRect()` | No model needed for DOM-visible fields |
| Face detection model | **face-api.js** (`TinyFaceDetector`) | 190KB, runs entirely in-browser, WebGL accelerated |
| OCR-based PII detection in image | **Tesseract.js** (WASM) | Finds Aadhaar/PAN text visually in screenshot |
| Visual redaction | **Canvas API** (native browser) | Draw black rectangles / Gaussian blur on sensitive boxes |
| Server communication | `fetch` (native, from background SW) | Built-in |
| Model runtime | WebGL (GPU) via face-api.js | Fastest, no WebGPU polyfill needed |

### Server-Side

| Layer | Technology | Why |
|---|---|---|
| Web framework | **Python FastAPI** | Async, fast, JSON native |
| VLM (multimodal) | **Ollama → `llava:7b`** or **`moondream`** | Open-source, offline, already have Ollama |
| Image processing | **Pillow** (Python) | Decode base64 image before sending to VLM |
| Action parser | Python regex + JSON schema validation | Extract structured commands from LLM output |
| CORS | FastAPI `CORSMiddleware` | Extension needs cross-origin access |
| Server runner | **uvicorn** | Standard FastAPI runner |

---

## Module 1 — Visual PII Detector

**Location:** `chrome-extension/src/background/vision/visualPiiDetector.ts`

**What it does:**
- Detects faces in the screenshot using face-api.js TinyFaceDetector
- Detects password fields, Aadhaar/PAN text, credit card numbers visually
- Returns list of bounding boxes `[{x, y, w, h, type, confidence}]`

**Two detection strategies:**

### Strategy A — DOM-Bounding-Box (fast, zero ML)
Query the live page for sensitive DOM elements and get their pixel coordinates:
```
input[type="password"]  → black box
input[autocomplete*="cc"] → black box
[data-aadhaar], [data-pan] → black box
```
Map DOM coords → screenshot coords using `window.devicePixelRatio`.

### Strategy B — Vision Model (face detection)
Load `face-api.js` TinyFaceDetector model in the extension background:
```
Load model from /public/models/tiny_face_detector/
Run on screenshot canvas
→ [{x, y, width, height, score}] bounding boxes
```

**New Files:**
- `chrome-extension/src/background/vision/visualPiiDetector.ts`
- `chrome-extension/src/background/vision/domBboxExtractor.ts`
- `chrome-extension/public/models/tiny_face_detector/` (model weights, ~190KB)

---

## Module 2 — Visual Redactor

**Location:** `chrome-extension/src/background/vision/visualRedactor.ts`

**What it does:**
- Takes base64 JPEG screenshot + bounding boxes
- Draws black filled rectangles over each sensitive region
- For faces: applies a pixelate/blur effect (draw → scale down → scale up)
- Returns: sanitized base64 PNG + redaction report

**Algorithm:**
```
1. Create OffscreenCanvas (no DOM needed, works in service worker)
2. Draw original screenshot
3. For each bbox:
   - type === "face"     → pixelate (8x8 block fill)
   - type === "password" → solid black rectangle
   - type === "pii_text" → solid black rectangle
4. Export canvas → base64 PNG
5. Return {sanitizedImage, redactionReport}
```

**Metrics this covers:**
- Precision of redaction (Criterion 3 — 20%)
- Recall of PII detection (Criterion 2 — 20%)

**New Files:**
- `chrome-extension/src/background/vision/visualRedactor.ts`
- `chrome-extension/src/background/vision/index.ts` (barrel export)

---

## Module 3 — ShieldBrowse Server

**Location:** `server/` (new top-level directory)

**Directory structure:**
```
server/
├── main.py               ← FastAPI app entry point
├── routes/
│   ├── agent.py          ← POST /agent/process
│   └── health.py         ← GET /health
├── services/
│   ├── vlm_client.py     ← Ollama API calls (llava:7b)
│   ├── action_parser.py  ← Parse LLM output to action list
│   └── image_utils.py    ← base64 decode, resize, validate
├── models/
│   └── schemas.py        ← Pydantic request/response models
├── requirements.txt
└── start.bat             ← One-click start for Windows
```

**API Contract:**

```
POST /agent/process
Content-Type: application/json

Request:
{
  "screenshot": "<base64 sanitized PNG>",
  "dom_context": "<redacted DOM text>",
  "task": "<user's original task description>",
  "redaction_report": {
    "faces_redacted": 2,
    "pii_fields_redacted": 3,
    "total_regions": 5
  }
}

Response:
{
  "actions": [
    {"type": "click",    "selector": "#submit-btn",      "description": "Click the submit button"},
    {"type": "scroll",   "direction": "down",             "amount": 300},
    {"type": "type",     "selector": "#search-input",     "value": "query text"},
    {"type": "navigate", "url": "https://example.com"}
  ],
  "reasoning": "I can see a form with a submit button in the bottom right...",
  "model_used": "llava:7b"
}
```

**VLM prompt template (inside `vlm_client.py`):**
```
You are a web automation assistant analyzing a sanitized browser screenshot.
Black boxes indicate redacted private information (faces, passwords, PII).
The user wants to: {task}

DOM context (text, already sanitized):
{dom_context}

Based on what you see in the screenshot, return ONLY a JSON array of actions.
```

**New Files (all new — `server/` does not exist yet):**
- `server/main.py`
- `server/routes/agent.py`
- `server/routes/health.py`
- `server/services/vlm_client.py`
- `server/services/action_parser.py`
- `server/services/image_utils.py`
- `server/models/schemas.py`
- `server/requirements.txt`
- `server/start.bat`

---

## Module 4 — Action Executor

**Location:** `chrome-extension/src/background/agent/actions/visionActionExecutor.ts`

**What it does:**
- Receives the action list from the server
- Executes each action using the existing Puppeteer `Page` object
- Reports back completion status to Side Panel

**Supported action types:**

| Action | Implementation |
|---|---|
| `click` | `page._puppeteerPage.click(selector)` |
| `scroll` | `page._puppeteerPage.evaluate(window.scrollBy)` |
| `type` | `page._puppeteerPage.type(selector, value)` |
| `navigate` | `browserContext.navigateTo(url)` |
| `wait` | `page._puppeteerPage.waitForTimeout(ms)` |

**Integration point:**  
Wire into `executor.ts` → after task input is received → trigger `VisionPipeline.run(task)`:

```
VisionPipeline.run(task):
  1. takeScreenshot()
  2. visualPiiDetector.detect(screenshot, domElements)
  3. visualRedactor.redact(screenshot, bboxes)
  4. serverClient.process(sanitizedScreenshot, domContext, task)
  5. visionActionExecutor.execute(actions)
  6. Report to SidePanel
```

**New Files:**
- `chrome-extension/src/background/agent/actions/visionActionExecutor.ts`
- `chrome-extension/src/background/vision/pipeline.ts` (orchestrator for steps 1–5)
- `chrome-extension/src/background/services/serverClient.ts` (fetch wrapper)

---

## Module 5 — Side Panel UI Overhaul + Rebrand

Already planned in `implementation_plan.md`. Key additions for vision:

- **Vision Mode toggle** in chat input area (enable/disable vision pipeline per task)
- **Redaction badge** shows `N regions redacted` after each step
- **Action trace panel** shows the list of actions the agent executed
- **Server status indicator** shows if ShieldBrowse server is reachable (green/red dot)

---

## Evaluation Metrics Coverage

| Criterion | Weight | Module Covering It | Expected Score |
|---|---|---|---|
| Accuracy of visual context from screen | 25% | Module 1 + 2 (screenshot + redacted image sent to VLM) | High |
| Recall/precision for PII detection | 20% | Module 1 (face-api + DOM bbox + Tesseract OCR) | High |
| Precision of redaction | 20% | Module 2 (Canvas black-box + pixelate) | High |
| Client-side resource utilization | 20% | face-api TinyFaceDetector (190KB, WebGL) | Good |
| End-to-end latency | 15% | Pipeline is parallelized: detect + redact locally, single server round-trip | Good |

---

## Execution Order (Step-by-Step)

```
Step 1  → Add face-api.js + model weights to extension public folder
Step 2  → Build Module 1: visualPiiDetector.ts (DOM bboxes + face detection)
Step 3  → Build Module 2: visualRedactor.ts (Canvas OffscreenCanvas)
Step 4  → Build server/ directory (FastAPI + llava:7b via Ollama)
Step 5  → Pull llava:7b model into Ollama (ollama pull llava:7b)
Step 6  → Build Module 4: visionActionExecutor.ts + pipeline.ts
Step 7  → Wire pipeline into executor.ts
Step 8  → Build serverClient.ts (fetch to FastAPI)
Step 9  → Side Panel UI overhaul (Module 5 from rebrand plan)
Step 10 → pnpm build + load extension + start server + end-to-end test
```

---

## Dependencies to Install

### Extension (add to `chrome-extension/package.json`)
```json
"face-api.js": "^0.22.2"
```

### Server (new `server/requirements.txt`)
```
fastapi==0.115.0
uvicorn==0.30.6
httpx==0.27.2
Pillow==10.4.0
python-multipart==0.0.12
pydantic==2.9.2
```

### New Ollama Model
```bash
ollama pull llava:7b
# or lighter alternative:
ollama pull moondream
```

---

## Risk & Mitigation

| Risk | Mitigation |
|---|---|
| `llava:7b` too slow on local machine | Use `moondream` (1.6GB, fastest multimodal on CPU) |
| OffscreenCanvas not available in MV3 SW | Fall back to `createImageBitmap` + blob URL approach |
| Face-api model load time | Load once on extension startup, cache in memory |
| Server cold start latency | Keep uvicorn always running via `start.bat` daemon |
| DOM bboxes don't map to screenshot coords | Multiply by `window.devicePixelRatio`, tested in page.ts already |

---

> [!IMPORTANT]
> **Approve this plan and I will start executing Step 1 immediately.**  
> Estimated implementation time: Steps 1–8 (core vision pipeline) in one session.
