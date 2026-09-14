Here is a complete, step-by-step developer onboarding and setup guide you can share with your friend so they can install, run, and test the **ShieldBrowse** extension and backend on their machine.

You can also copy-paste this directly into a `COLLABORATOR_SETUP.md` file in the repo.

---

# 🚀 ShieldBrowse — Collaborator Setup & Testing Guide

Welcome to the team! Follow this guide to set up the project locally, build the Chrome Extension, launch the server, and verify the privacy-preserving vision pipeline.

---

## 🛠️ 1. Prerequisites (What Your Friend Needs Installed)

Make sure your machine has:
1. **Node.js** (v18 or v20 LTS recommended): [Download Node.js](https://nodejs.org/)
2. **pnpm** (Package manager):
   ```bash
   npm install -g pnpm
   ```
3. **Python** (v3.10 or v3.11): [Download Python](https://www.python.org/) *(Ensure "Add Python to PATH" is checked during install)*
4. **Google Chrome** browser
5. **Git** (to clone and push commits)

---

## 📥 2. Clone the Repository & Directory Structure

```bash
git clone <YOUR_REPO_URL>
cd sih
```

Project workspace structure:
```text
sih/
├── Project/
│   └── nanobrowser/
│       ├── chrome-extension/      # Extension source code
│       ├── pages/                 # Sidepanel and popup UI
│       ├── packages/              # Shared modules & utils
│       ├── server/                # FastAPI backend (VLM / Agent)
│       └── package.json           # Root package scripts
├── implementation_plan.md         # Phased roadmap & missing tasks
```

---

## 📦 3. Install Extension Dependencies & Build

Open a terminal at `Project/nanobrowser`:

```bash
cd Project/nanobrowser

# Install all workspace dependencies
pnpm install

# Build the extension bundle (creates the dist folder)
pnpm build
```

> 💡 **Tip during development:**  
> If making changes to the UI or extension background code, run:
> ```bash
> pnpm dev
> ```
> This enables live rebuild on file save.

---

## 🌐 4. Load the Extension into Google Chrome

1. Open **Google Chrome**.
2. Navigate to: `chrome://extensions/`
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. In the top-left, click **Load unpacked**.
5. Select the build output directory:
   ```text
   Project/nanobrowser/dist
   ```
   *(or the exact folder where `manifest.json` is generated inside `dist/`)*
6. You will see **ShieldBrowse / NanoBrowser** appear in your extension list!
7. Click the **Puzzle icon** (Extensions) in Chrome's top toolbar and pin the extension to your toolbar.

---

## 🐍 5. Set Up and Run the Python Backend Server

The extension uses the local FastAPI server to interact with the Vision Language Model (VLM).

### Option A: Quick Start (Windows)
Open a new terminal:
```bash
cd Project/nanobrowser/server
./start.bat
```

### Option B: Manual Virtual Environment Setup
```bash
cd Project/nanobrowser/server

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run server
uvicorn main:app --reload --port 8000
```

### Verify Server Health:
Open your browser and visit:  
👉 `http://127.0.0.1:8000/health`  
It should return `{"status": "ok"}` or equivalent healthy JSON.

---

## 🤖 6. VLM / LLM Setup (OpenRouter or Ollama)

- **OpenRouter (Default)**: Check `Project/nanobrowser/server/services/vlm_client.py`. Set your `OPENROUTER_API_KEY` in your environment or in a `.env` file inside the `server/` directory:
  ```env
  OPENROUTER_API_KEY=your_key_here
  ```
- **Local Ollama (Alternative)**: If running offline models:
  ```bash
  ollama run llava:7b
  # or
  ollama run moondream
  ```

---

## 🔍 7. How to Test & Verify

### Step 1: Open Side Panel
1. Click the pinned extension icon in your Chrome toolbar.
2. The **Side Panel** will open on the right side of your browser.

### Step 2: Test on Sensitive Pages
1. Navigate to any web page containing form inputs (e.g., login screens, password fields, or test pages).
2. Enter a prompt in the SidePanel chat, for example:
   > *"Click on the username input and sign in"*
3. Open Chrome Developer Tools for the extension to inspect logs:
   - Go to `chrome://extensions/`
   - Find your extension and click **Inspect views: service worker** (Background)
   - Right-click inside the Side Panel and click **Inspect** (UI logs)

### Step 3: Check Vision Redaction Output
- Look at the console logs in the Service Worker inspection window.
- You will see logs from:
  - `visualPiiDetector.ts` (Detected bounding boxes)
  - `visualRedactor.ts` (Redaction applied to screenshot)
  - `serverClient.ts` (Sending sanitized payload to `http://localhost:8000/agent/process`)

---

## 📌 8. What Your Friend Should Work on Next

Point your collaborator directly to **`implementation_plan.md`** under the **"🔴 Missing — Must Build for Hackathon Demo"** section.

The top 3 immediate priorities are:
1. **Task 1: Wire Vision Pipeline → SidePanel UI** (`background/index.ts` ↔ `SidePanel.tsx` ↔ `PrivacyShieldModal.tsx`).
2. **Task 2: Live Privacy Shield Status Indicator** (pulsing active status + count badge in header).
3. **Task 3: Prompt Injection Stripping Pass** (`privacy/ipiSanitizer.ts`).