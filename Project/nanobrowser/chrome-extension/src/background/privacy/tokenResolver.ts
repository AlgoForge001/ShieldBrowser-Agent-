/**
 * Token Resolver — Privacy Shadow Action Interceptor
 *
 * Intercepts AI-generated actions BEFORE they are executed on the DOM.
 * If an action's value is a semantic token (e.g. "<IDENTITY_ID>"), it is
 * resolved to the real value from SecureVault before the DOM interaction.
 *
 * This is the bridge between Privacy Shadow (what the AI sees) and
 * the real browser (what actually gets typed/submitted).
 *
 * Flow:
 *   AI returns → { action: "type", value: "<IDENTITY_ID>" }
 *   resolveAction() → { action: "type", value: "123456789012" }  ← real
 *   DOM → actual value typed into field ✅
 */

import { SecureVault } from './secureVault';

/** Matches semantic tokens like <IDENTITY_ID>, <CREDENTIAL>, <OTP>, etc. */
const TOKEN_PATTERN = /^<[A-Z][A-Z0-9_]*>$/;

/**
 * Returns true if the string is a Privacy Shadow semantic token.
 */
export function isToken(value: string): boolean {
  return TOKEN_PATTERN.test(value.trim());
}

/**
 * Resolves a single value: if it's a token, returns the real value from vault.
 * If not a token (or token not in vault), returns the value unchanged.
 *
 * @param value - e.g. "<IDENTITY_ID>" or "some plain text"
 * @returns resolved real value, or original value if not a token
 */
export function resolveValue(value: string): string {
  const trimmed = value.trim();
  if (isToken(trimmed)) {
    const resolved = SecureVault.resolve(trimmed);
    // If vault didn't have it, resolved === trimmed (token string)
    // That's a safe fallback — the form field won't get filled with wrong data
    return resolved;
  }
  return value;
}

/**
 * Mutates an action object in place, resolving any token values.
 * Safe to call on every action — non-token values pass through unchanged.
 *
 * @param action - Action object from the VLM server (may have .value field)
 * @returns the same action object with resolved .value (mutated in place)
 */
export function resolveAction<T extends { value?: string }>(action: T): T {
  if (action.value && typeof action.value === 'string') {
    action.value = resolveValue(action.value);
  }
  return action;
}

/**
 * Resolves all actions in a list.
 * Returns the same array (mutated in place) with resolved values.
 */
export function resolveActions<T extends { value?: string }>(actions: T[]): T[] {
  for (const action of actions) {
    resolveAction(action);
  }
  return actions;
}

export const TokenResolver = {
  isToken,
  resolveValue,
  resolveAction,
  resolveActions,
};

