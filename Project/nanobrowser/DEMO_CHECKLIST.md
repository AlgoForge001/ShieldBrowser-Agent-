# 🚨 SIH DEMO CHECKLIST — Screen Classifier (CLIP Model)

## MUST DO: 24 Hours Before Demo

### Step 1: Cache the CLIP Model on the Judging Machine

The screen classifier uses a **153MB CLIP model** (Xenova/clip-vit-base-patch32, q8).
After the first download it is cached permanently in browser Cache Storage.
**You MUST run this once on the exact Chrome profile used for judging.**

1. On the judging machine, open Chrome with the Nanobrowser extension loaded
2. Navigate to any webpage (e.g., google.com)
3. Open the Side Panel → you will see the classification badge
4. Watch Chrome DevTools console (F12) for:
   ```
   [ScreenClassifier] Loading CLIP ViT-B/32 (q8)... (~153MB, cached after first run)
   [ScreenClassifier] CLIP model loaded and cached in XXXXms ✅
   ```
5. The first load takes **2–5 minutes** depending on internet speed.
6. After this message, the model is permanently cached.

### Step 2: Verify Offline Functionality

After the model is cached:
1. Disconnect WiFi / turn off internet
2. Close and reopen Chrome
3. Reload the extension (`chrome://extensions` → click reload)
4. Open Side Panel on any page
5. ✅ Classification should still work without internet

### Step 3: Test Classification on Demo Pages

Open each URL and verify the Side Panel shows the correct badge:

| URL | Expected Label | Expected Privacy Level |
|-----|---------------|----------------------|
| `https://www.sbi.co.in` | `financial` | 🔴 HIGH |
| `https://uidai.gov.in` | `identity` | 🔴 HIGH |
| `https://www.instagram.com` | `social` | 🟡 MEDIUM |
| `https://en.wikipedia.org` | `general` | 🟢 LOW |

### Step 4: Verify Redaction Policy Changes

- On **SBI / UIDAI**: Open pipeline → confirm face detection IS enabled + full text redaction
- On **Wikipedia**: Open pipeline → confirm face detection IS skipped (low-risk page)

---

## Classification Badge Reference

The Side Panel shows:
```
📊 Screen: financial (0.95) [heuristic] — 🔴 HIGH PRIVACY
📊 Screen: social (0.92) [heuristic] — 🟡 MEDIUM PRIVACY
📊 Screen: general (0.73) [clip] — 🟢 LOW PRIVACY
```

Sources:
- `[heuristic]` = URL/DOM pattern match (0ms, instant)
- `[clip]` = CLIP ViT-B/32 zero-shot inference (~200-400ms, only on unrecognized pages)

---

## Troubleshooting

**Model not loading (CORS error in console):**
- Check that `content_security_policy` in manifest allows `https://cdn.jsdelivr.net`

**"CLIP not ready yet" always showing:**
- The offscreen document may not be loading `screen-classifier-worker.js`
- Check `vision-offscreen.html` is in `dist/offscreen/`

**Classification always returns "general":**
- This is correct on demo pages not in the heuristic pattern list
- CLIP will classify them correctly after model loads

**Extension size too large:**
- Model weights are NOT bundled inside extension — they are CDN-fetched and browser-cached
- Extension package itself remains the same size
