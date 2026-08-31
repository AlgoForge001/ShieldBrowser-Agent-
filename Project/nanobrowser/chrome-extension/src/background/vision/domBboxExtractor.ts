/**
 * DOM Bounding Box Extractor — Module 1 (Strategy A)
 *
 * Queries the live page for sensitive DOM elements and returns their
 * pixel coordinates in screenshot space (multiplied by devicePixelRatio).
 *
 * This runs inside a content-script context (injected via scripting API)
 * and returns serialisable plain objects back to the service worker.
 */

export interface DomBbox {
  x: number;
  y: number;
  w: number;
  h: number;
  type: 'password' | 'credit_card' | 'aadhaar_field' | 'pan_field' | 'otp_field';
}

/**
 * CSS selectors for sensitive DOM elements.
 * Run inside the page context (content script / scripting.executeScript).
 */
const SENSITIVE_SELECTORS: Array<{ selector: string; type: DomBbox['type'] }> = [
  { selector: 'input[type="password"]', type: 'password' },
  {
    selector:
      'input[autocomplete*="cc-number"], input[autocomplete*="cc-csc"], ' +
      'input[name*="card"], input[name*="cvv"], input[name*="cvc"]',
    type: 'credit_card',
  },
  {
    selector:
      'input[name*="aadhaar"], input[name*="aadhar"], ' +
      'input[placeholder*="aadhaar"], input[placeholder*="aadhar"], ' +
      '[data-aadhaar]',
    type: 'aadhaar_field',
  },
  {
    selector:
      'input[name*="pan"], input[placeholder*="PAN"], ' +
      '[data-pan]',
    type: 'pan_field',
  },
  {
    selector:
      'input[name*="otp"], input[placeholder*="OTP"], ' +
      'input[autocomplete="one-time-code"]',
    type: 'otp_field',
  },
];

/**
 * Extracts bounding boxes of sensitive DOM elements.
 * Must be run in the PAGE context via chrome.scripting.executeScript.
 *
 * Returns serialisable DomBbox[] ready to be passed back to SW.
 */
export function extractDomBboxes(): DomBbox[] {
  const dpr = window.devicePixelRatio || 1;
  const results: DomBbox[] = [];

  const SENSITIVE_SELECTORS_INLINE: Array<{ selector: string; type: string }> = [
    { selector: 'input[type="password"]', type: 'password' },
    {
      selector:
        'input[autocomplete*="cc-number"], input[autocomplete*="cc-csc"], ' +
        'input[name*="card"], input[name*="cvv"], input[name*="cvc"]',
      type: 'credit_card',
    },
    {
      selector:
        'input[name*="aadhaar"], input[name*="aadhar"], ' +
        'input[placeholder*="aadhaar"], input[placeholder*="aadhar"], ' +
        '[data-aadhaar]',
      type: 'aadhaar_field',
    },
    {
      selector: 'input[name*="pan"], input[placeholder*="PAN"], [data-pan]',
      type: 'pan_field',
    },
    {
      selector:
        'input[name*="otp"], input[placeholder*="OTP"], input[autocomplete="one-time-code"]',
      type: 'otp_field',
    },
  ];

  for (const { selector, type } of SENSITIVE_SELECTORS_INLINE) {
    let elements: NodeListOf<Element>;
    try {
      elements = document.querySelectorAll(selector);
    } catch {
      continue;
    }

    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      // Skip invisible elements
      if (rect.width === 0 || rect.height === 0) continue;

      // Add a small padding so redaction box covers label/placeholder text
      const padding = 4;
      results.push({
        x: Math.max(0, Math.round((rect.left - padding) * dpr)),
        y: Math.max(0, Math.round((rect.top - padding) * dpr)),
        w: Math.round((rect.width + padding * 2) * dpr),
        h: Math.round((rect.height + padding * 2) * dpr),
        type: type as DomBbox['type'],
      });
    }
  }

  return results;
}

export { SENSITIVE_SELECTORS };
