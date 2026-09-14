/**
 * Page visual scan — injects into the active tab to collect sensitive
 * field boxes and visible text PII boxes in screenshot-pixel space.
 *
 * The injected function must stay self-contained (no closed-over imports).
 */

import { getPiiPatternDefs } from '../privacy/piiDetector';
import type { PiiPatternDef } from '../privacy/piiDetector';

export interface PageVisualBox {
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
  piiType?: string;
}

export interface PageVisualScanResult {
  boxes: PageVisualBox[];
  snippet: string;
  url: string;
  title: string;
}

export async function resolveHttpTabId(preferredTabId?: number): Promise<number | null> {
  if (preferredTabId) {
    try {
      const tab = await chrome.tabs.get(preferredTabId);
      if (tab.id && tab.url?.startsWith('http')) return tab.id;
    } catch {
      // fall through to active-tab lookup
    }
  }

  const allTabs = await chrome.tabs.query({ active: true });
  const tab = allTabs.find(t => t.url?.startsWith('http'));
  return tab?.id ?? null;
}

/**
 * Runs in the PAGE context via chrome.scripting.executeScript.
 */
function scanPageForVisualPii(patternDefs: PiiPatternDef[]): PageVisualScanResult {
  const dpr = window.devicePixelRatio || 1;
  const boxes: PageVisualBox[] = [];
  const paddingFor = (px: number) => px;

  const pushRect = (rect: DOMRect, type: string, piiType?: string, pad = 4) => {
    if (!rect.width || !rect.height) return;
    boxes.push({
      x: Math.max(0, Math.round((rect.left - pad) * dpr)),
      y: Math.max(0, Math.round((rect.top - pad) * dpr)),
      w: Math.round((rect.width + pad * 2) * dpr),
      h: Math.round((rect.height + pad * 2) * dpr),
      type,
      piiType,
    });
  };

  const SELECTORS: Array<{ sel: string; type: string; piiType?: string }> = [
    {
      sel:
        'input[type="password"], input[name*="password" i], input[name*="passwd" i], input[name*="pwd" i], ' +
        'input[id*="password" i], input[placeholder*="password" i], input[autocomplete*="password" i]',
      type: 'password',
      piiType: 'PASSWORD',
    },
    {
      sel:
        'input[autocomplete*="cc-number"], input[autocomplete*="cc-csc"], input[autocomplete*="cc-exp"], ' +
        'input[name*="card"], input[name*="cvv"], input[name*="cvc"]',
      type: 'credit_card',
      piiType: 'CREDIT_CARD',
    },
    {
      sel: 'input[name*="aadhaar"], input[name*="aadhar"], input[placeholder*="aadhaar" i], [data-aadhaar]',
      type: 'aadhaar_field',
      piiType: 'AADHAAR',
    },
    {
      sel: 'input[name*="pan"], input[placeholder*="PAN"], [data-pan]',
      type: 'pan_field',
      piiType: 'PAN',
    },
    {
      sel: 'input[name*="otp"], input[placeholder*="OTP" i], input[autocomplete="one-time-code"]',
      type: 'otp_field',
      piiType: 'OTP',
    },
    {
      sel: 'input[type="email"], input[autocomplete="email"]',
      type: 'email_field',
      piiType: 'EMAIL',
    },
    {
      sel: 'input[type="tel"], input[autocomplete="tel"]',
      type: 'phone_field',
      piiType: 'PHONE',
    },
  ];

  for (const { sel, type, piiType } of SELECTORS) {
    try {
      document.querySelectorAll(sel).forEach(el => {
        pushRect(el.getBoundingClientRect(), type, piiType);
      });
    } catch {
      /* skip invalid selectors */
    }
  }

  const patterns = patternDefs.map(d => ({
    type: d.type,
    pattern: new RegExp(d.source, d.flags.includes('g') ? d.flags : `${d.flags}g`),
  }));

  const looksLikePii = (text: string): string | undefined => {
    for (const { type, pattern } of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) return type;
    }
    return undefined;
  };

  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(el => {
    const typeAttr = ('type' in el ? el.type : '').toLowerCase();
    if (typeAttr === 'password' || typeAttr === 'hidden') return;
    const val = el.value?.trim();
    if (!val) return;
    const piiType = looksLikePii(val);
    if (piiType) {
      const boxType =
        piiType === 'EMAIL' ? 'email_field' : piiType === 'PHONE' ? 'phone_field' : piiType === 'CREDIT_CARD' ? 'credit_card' : 'pii_text';
      pushRect(el.getBoundingClientRect(), boxType, piiType);
    }
  });

  const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA']);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (skipTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      const style = window.getComputedStyle(parent);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue ?? '';
    for (const { type, pattern } of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        try {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          pushRect(range.getBoundingClientRect(), 'pii_text', type, paddingFor(2));
        } catch {
          /* range can fail on some nodes */
        }
      }
    }
  }

  return {
    boxes,
    snippet: document.body?.innerText?.slice(0, 4000) ?? '',
    url: location.href,
    title: document.title,
  };
}

export async function scanTabForVisualPii(tabId: number): Promise<PageVisualScanResult> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: scanPageForVisualPii,
    args: [getPiiPatternDefs({ forVisualText: true })],
  });

  return (
    results?.[0]?.result ?? {
      boxes: [],
      snippet: '',
      url: '',
      title: '',
    }
  );
}

export async function getImageDimensions(
  b64: string,
  mimeType: string,
): Promise<{ width: number; height: number }> {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeType });
    const bmp = await createImageBitmap(blob);
    const { width, height } = bmp;
    bmp.close();
    return { width, height };
  } catch {
    return { width: 1280, height: 720 };
  }
}

export function stripImageDataUrl(value: string): string {
  return value.replace(/^data:[^;]+;base64,/, '');
}
