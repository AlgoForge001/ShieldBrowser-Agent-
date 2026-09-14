/**
 * IPI Sanitizer — Indirect Prompt Injection Defense (Privacy Shield Angle A)
 *
 * Sanitizes untrusted text extracted from web page DOM before it is
 * fed to LLMs or the Vision Language Model (VLM).
 *
 * Defenses:
 *   1. Zero-Width Unicode Stripping: Removes invisible characters used to bypass tokenizers
 *   2. Prompt Injection Neutralization: Detects and defangs jailbreaks, role-overrides,
 *      and control token injections (e.g. [INST], <|im_start|>, 'ignore previous instructions')
 *   3. Untrusted Content Sandboxing: Wraps page context in <UNTRUSTED_PAGE> delimiters
 */

export interface IpiSanitizationResult {
  original: string;
  sanitized: string;
  hasInjections: boolean;
  strippedCount: number;
  detectedPatterns: string[];
  zeroWidthCount: number;
}

// Invisible / zero-width characters often used to break up injection strings
// (e.g., "i\u200Bgnore previous instructions")
const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF\u2060\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

// Dangerous prompt injection patterns (Indirect Prompt Injection - IPI)
const INJECTION_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  {
    name: 'IGNORE_PREVIOUS',
    regex: /\b(ignore|disregard|forget|override)\s+(all\s+)?(previous|prior|above|existing)\s+(instructions|directions|prompts|commands|rules|directives)\b/gi,
  },
  {
    name: 'YOU_ARE_NOW',
    regex: /\byou\s+are\s+now\s+(a\s+|an\s+)?(unrestricted|evil|admin|developer|dan|jailbroken|new\s+system|ai\s+without\s+rules)\b/gi,
  },
  {
    name: 'SYSTEM_PROMPT_INJECT',
    regex: /\b(system\s+prompt\s*:|new\s+instructions\s*:|developer\s+mode\s+(activated|enabled|on))\b/gi,
  },
  {
    name: 'JAILBREAK_KEYWORD',
    regex: /\b(DAN\s+mode|jailbreak|bypass\s+(safety|security|filters|guardrails))\b/gi,
  },
  {
    name: 'LLM_CONTROL_TOKENS',
    regex: /(\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>|<\|system\|>|<\|user\|>|<\|assistant\|>|<<SYS>>|<<\/SYS>>|<\|endoftext\|>)/gi,
  },
];

/**
 * Strips invisible zero-width unicode characters and normalizes non-breaking spaces.
 */
export function stripZeroWidth(text: string): { clean: string; removedCount: number } {
  if (!text) return { clean: '', removedCount: 0 };

  const matches = text.match(ZERO_WIDTH_REGEX);
  const removedCount = matches ? matches.length : 0;
  // Replace zero-width with empty string, and non-breaking space with regular space
  const clean = text.replace(ZERO_WIDTH_REGEX, '').replace(/\u00A0/g, ' ');

  return { clean, removedCount };
}

/**
 * Sanitizes untrusted text by stripping zero-width characters and defanging
 * prompt injection patterns.
 *
 * @param text - Untrusted DOM text or user input
 * @returns IpiSanitizationResult with cleaned text and threat metadata
 */
export function sanitizePromptInjection(text: string): IpiSanitizationResult {
  if (!text) {
    return {
      original: '',
      sanitized: '',
      hasInjections: false,
      strippedCount: 0,
      detectedPatterns: [],
      zeroWidthCount: 0,
    };
  }

  // 1. Strip zero-width bypass attempts first
  const { clean, removedCount: zeroWidthCount } = stripZeroWidth(text);

  let sanitized = clean;
  const detectedPatterns: string[] = [];
  let strippedCount = 0;

  // 2. Scan and defang each injection pattern
  for (const pattern of INJECTION_PATTERNS) {
    // Reset regex index if global
    pattern.regex.lastIndex = 0;
    const matches = clean.match(pattern.regex);
    if (matches && matches.length > 0) {
      detectedPatterns.push(pattern.name);
      strippedCount += matches.length;
      // Defang by replacing with safe marker [BLOCKED_INJECTION]
      sanitized = sanitized.replace(pattern.regex, '[BLOCKED_INJECTION]');
    }
  }

  return {
    original: text,
    sanitized,
    hasInjections: strippedCount > 0,
    strippedCount,
    detectedPatterns,
    zeroWidthCount,
  };
}

/**
 * Wraps page-derived untrusted text in boundary delimiters.
 * Ensures the VLM treats DOM text strictly as data, never as system instructions.
 *
 * @param text - Cleaned text to encapsulate
 * @returns Text enclosed in <UNTRUSTED_PAGE> tags
 */
export function wrapUntrustedContext(text: string): string {
  return `<UNTRUSTED_PAGE>\n${text}\n</UNTRUSTED_PAGE>`;
}

/**
 * High-level helper: strips zero-width, defangs injections, and wraps in untrusted boundary.
 */
export function sanitizeAndWrapDom(rawText: string): {
  wrapped: string;
  result: IpiSanitizationResult;
} {
  const result = sanitizePromptInjection(rawText);
  const wrapped = wrapUntrustedContext(result.sanitized);
  return { wrapped, result };
}
