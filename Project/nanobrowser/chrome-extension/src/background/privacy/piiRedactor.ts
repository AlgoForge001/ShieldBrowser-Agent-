/**
 * PII Redactor — Privacy Shield Module
 *
 * Takes raw text (DOM content, page titles, URLs) and returns
 * a sanitized version with all PII replaced by typed tokens.
 * The original values are never stored or transmitted.
 */

import { detectPii, type PiiDetectionResult, type PiiMatch, PiiType } from './piiDetector';
import {
  sanitizePromptInjection,
  wrapUntrustedContext,
  type IpiSanitizationResult,
} from './ipiSanitizer';

export interface RedactionResult {
  original: string;
  redacted: string;
  wasRedacted: boolean;
  detectionResult: PiiDetectionResult;
  ipiResult?: IpiSanitizationResult;
}

export interface RedactionStats {
  totalScanned: number;
  totalRedacted: number;
  piiTypesEncountered: Set<PiiType>;
}

/**
 * Redacts all detected PII in text, replacing each match with a typed token.
 * Overlapping matches are handled — the earliest/longest match wins.
 *
 * @param text - Raw text to sanitize
 * @param options - Optional flags for IPI sanitization and untrusted context wrapping
 * @returns RedactionResult with the redacted string and metadata
 */
export function redactText(
  text: string,
  options?: { sanitizeIpi?: boolean; wrapUntrusted?: boolean },
): RedactionResult {
  let inputText = text;
  let ipiResult: IpiSanitizationResult | undefined;

  if (options?.sanitizeIpi) {
    ipiResult = sanitizePromptInjection(inputText);
    inputText = ipiResult.sanitized;
  }

  const detectionResult = detectPii(inputText);

  if (!detectionResult.hasPii) {
    let finalRedacted = inputText;
    if (options?.wrapUntrusted) {
      finalRedacted = wrapUntrustedContext(finalRedacted);
    }
    return {
      original: text,
      redacted: finalRedacted,
      wasRedacted: Boolean(ipiResult?.hasInjections),
      detectionResult,
      ipiResult,
    };
  }

  // Build redacted string by replacing detected matches
  // We process in reverse order (end → start) to preserve index integrity
  const matches = [...detectionResult.matches].sort((a, b) => b.start - a.start);

  let redacted = inputText;
  const seenRanges: Array<{ start: number; end: number }> = [];

  for (const match of matches) {
    // Skip if this range overlaps with one already processed
    const overlaps = seenRanges.some(
      r => match.start < r.end && match.end > r.start,
    );
    if (overlaps) continue;

    redacted =
      redacted.slice(0, match.start) +
      match.redactedWith +
      redacted.slice(match.end);

    seenRanges.push({ start: match.start, end: match.end });
  }

  if (options?.wrapUntrusted) {
    redacted = wrapUntrustedContext(redacted);
  }

  return {
    original: text,
    redacted,
    wasRedacted: true,
    detectionResult,
    ipiResult,
  };
}

/**
 * Convenience helper for untrusted DOM context:
 * 1. Strips invisible zero-width characters
 * 2. Defangs Indirect Prompt Injection (IPI) patterns
 * 3. Redacts detected PII with tokens
 * 4. Wraps in <UNTRUSTED_PAGE> boundaries
 */
export function redactDomContext(rawDomText: string): RedactionResult {
  return redactText(rawDomText, { sanitizeIpi: true, wrapUntrusted: true });
}

/**
 * Redacts PII from a URL string (query params, fragments, path segments).
 * Splits on common delimiters, redacts each part, rejoins.
 *
 * @param url - Raw URL string
 * @returns Sanitized URL string
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Redact each query param value
    const newParams = new URLSearchParams();
    parsed.searchParams.forEach((value, key) => {
      const result = redactText(value);
      newParams.set(key, result.redacted);
    });
    parsed.search = newParams.toString() ? `?${newParams.toString()}` : '';

    // Redact the pathname
    const pathResult = redactText(parsed.pathname);
    parsed.pathname = pathResult.redacted;

    return parsed.toString();
  } catch {
    // Not a valid URL — treat as plain text
    return redactText(url).redacted;
  }
}

/**
 * Redacts PII from a tab title or page title.
 */
export function redactTitle(title: string): string {
  return redactText(title).redacted;
}

/**
 * Redacts PII from all string fields in a structured state object.
 * Walks the object shallowly (does not recurse into nested objects).
 *
 * @param obj - Key-value object with potential PII in string values
 * @returns New object with redacted values
 */
export function redactObjectStrings<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj } as T;
  for (const key of Object.keys(result)) {
    const val = result[key as keyof T];
    if (typeof val === 'string') {
      (result as Record<string, unknown>)[key] = redactText(val).redacted;
    }
  }
  return result;
}

/**
 * Summarizes what PII was found and redacted from a given text,
 * for display in the audit log / side panel.
 */
export function describeRedaction(result: RedactionResult): string {
  if (!result.wasRedacted) return 'No PII detected';
  const types = result.detectionResult.piiTypes.join(', ');
  const count = result.detectionResult.matches.length;
  return `Redacted ${count} PII item(s): ${types}`;
}

/**
 * Accumulate stats across multiple redaction calls.
 */
export function accumulateStats(
  stats: RedactionStats,
  result: RedactionResult,
): void {
  stats.totalScanned++;
  if (result.wasRedacted) {
    stats.totalRedacted++;
    for (const t of result.detectionResult.piiTypes) {
      stats.piiTypesEncountered.add(t);
    }
  }
}

export function createRedactionStats(): RedactionStats {
  return {
    totalScanned: 0,
    totalRedacted: 0,
    piiTypesEncountered: new Set(),
  };
}
