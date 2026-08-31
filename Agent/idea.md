Problem Statement Title	
On-device Visual Perception for Light-weight Browser Agents
Description	


Background AI agents are becoming omnipresent in the current era and can play an important role in our digital interactions. If an agentic AI pipeline has access to our visual context, screen states, they can assist users in complex workflows and automate many tasks. Most of the agentic AI pipelines are deployed on server side which limits the type to data that a user can share with it. It would open a new dimension of possibilities, if a local agent is deployed on user machine particularly browser which can eliminate the need to share the sensitive data with the server. Local system generally has fewer resources than server and is unable to host a full-fledged pipeline therefore only the non-sensitive data such as structure of the screen, application fields etc can be sent to server for processing.

Modern browser APIs (such as WebGPU and WebAssembly) and local inference libraries (like ONNX Runtime Web and Transformers.js) have unlocked the ability to run lightweight machine learning models directly on the client. The aim is to bridge these two environments: leveraging the reasoning power of cloud or server based AI while strictly enforcing data privacy at the client side.

Description Participants are required to build a privacy-preserving vision agent which runs on browser. This involves implementing a client-side architecture where a local Vision Transformer (ViT) or equivalent computer vision model 'reads' the user's screen and takes decision based on that. If it requires the visual context to be sent to server, it shall sanitize the sensitive/PII data using DOM tags or any other method, before any network request is made. It should dynamically detect and redact sensitive elements. For example, blurring faces, blacking out passwords, and masking PII etc. Only this anonymized, unidentifiable data should be transmitted to the central server which should be aware for this redaction scheme and can process data accordingly. The server will then process the sanitized context and return actionable commands for the browser agent to execute. Participants must balance the trade-offs between inference latency and the accuracy.

Expected Solution A successful submission should include a working prototype consisting of client side extension and server that demonstrates the following:

Client-side (extension/JS) running in popular browsers (chrome, Firefox) components:

• Local Vision Processing: Implementation of a client-side vision model running in the browser (e.g., via WebGPU) that evaluates the current screen state.
• Privacy Preserving Filter: A mechanism for sanitizing sensitive or personal visual data. This can be achieved through local bounding-box redaction, semantic obfuscation, masking etc. This should be clearly demonstrated.

Server-side implementation components:

• Server Side Integration: The transmission of the anonymized visual context to a centralized LLM/VLM, which successfully interprets the sanitized data and returns the response which may be processed data to be again ingested by local client or an UI action (e.g., 'click the submit button,' 'scroll down') that the local client executes.
• Participants are free to use any offline deployable (open-source/open-weights) model on server side. During SIH they can use cloud hosted version of these. An end-to-end task assisting the user should be demonstrated.

Evaluation will be done on the following metrics:

1-Accuracy of visual context from screen â€“ 25% 2-Recall and precision for detection of sensitive/PII data â€“ 20% 3-Precision of redaction â€“ 20% 4-Client side resource utilization â€“ 20% 5-Overall end-to-end latency of the provided task -15%





## note down :
Before implementing this plan, fix one critical issue:

MobileViT-XXS is an ImageNet-pretrained classifier — it CANNOT output labels
like "financial", "identity", "social", "general" because it was never trained
on those categories. Using it as planned will produce meaningless ImageNet
class outputs, not the risk categories we need.

Switch to a ZERO-SHOT image classification approach instead:
- Use Transformers.js's `zero-shot-image-classification` pipeline
- Use a CLIP-based model (e.g., Xenova/clip-vit-base-patch32, or a smaller
  CLIP variant if available for lower latency)
- Pass our own candidate labels at inference time, e.g.:
  ["a banking or financial webpage", "an identity verification or KYC form",
   "a social media page", "a general webpage"]
- This requires no fine-tuning and will actually work out of the box

Also:
1. Confirm the offscreen document merge (Option A) — merge screen classifier
   into the SAME offscreen document as the face detector, since MV3 only
   allows one.
2. Bundle the model weights inside the extension package (not CDN-fetched at
   runtime) so it works offline during judging/demo.
3. After implementing, show me: (a) real inference latency on this machine,
   (b) actual classification output on 3 different real webpages (a bank
   login page, a social media feed, a generic news site), (c) confirm the
   redaction policy actually changes based on the classification output.

Do not proceed with the plain MobileViT-XXS approach — it will not work for
our label set.


## first answer this :
This plan is approved to implement, with 3 mandatory clarifications built in
— do not proceed without these:

1. PRECEDENCE RULE (critical): When CLIP is loaded and both heuristic and CLIP
   produce a result, heuristic wins whenever it has a confident match
   (URL pattern match OR sensitive DOM field found, score >= 0.90). CLIP's
   output is only used for the final privacyLevel decision when heuristic
   returns the "general/no-match" default (score 0.80, no pattern found).
   Implement this precedence explicitly in screenClassifier.ts — write it as
   a clear if/else, not an averaging or highest-score-wins logic. Show me
   this exact code block when done.

2. CACHE TEXT EMBEDDINGS: Since our 6 candidate labels are fixed, precompute
   and cache their text embeddings once at classifier initialization, not on
   every classification call. Confirm the actual per-call latency after this
   optimization (image encoding only, not re-encoding text every time).

3. PRE-DEMO CHECKLIST: Add an explicit note/README section: "Before SIH
   demo, run the extension once on the EXACT machine/browser profile that
   will be used for judging, to trigger and confirm the 153MB CLIP model
   download and cache. Verify offline functionality after caching by
   disabling network and re-testing classification."

After implementing, show me:
- The precedence logic code
- Real classification output + latency on 3-4 real pages (banking, social,
  general) after text-embedding caching
- Confirmation that heuristic overrides CLIP correctly in a test case where
  you deliberately make them disagree (e.g., visit a banking URL but mock
  CLIP to return "general" — confirm final decision is still "financial")