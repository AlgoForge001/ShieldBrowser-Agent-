/**
 * Secure Vault — Privacy Shadow Token Store
 *
 * Maintains a tab-scoped, in-memory mapping of semantic tokens → real PII values.
 *
 * The vault is populated during DOM scan (BEFORE masking) and is used by
 * TokenResolver to substitute real values back into AI-generated actions
 * immediately before DOM execution.
 *
 * Security properties:
 *   - Stored in service worker memory only (Map<>) — never written to disk
 *   - Tab-scoped: cleared when a new scan begins or vault.clear() is called
 *   - Never sent to server — OpenRouter/VLM only ever receives token strings
 *   - Only tokenResolver.ts can call resolve() — no external API
 */

export interface VaultEntry {
  /** Semantic token, e.g. "<IDENTITY_ID>" */
  token: string;
  /** Actual PII value, e.g. "123456789012" */
  realValue: string;
  /** CSS selector that matched the field, e.g. "input[name='aadhaar']" */
  fieldSelector: string;
  /** PII type classification, e.g. "IDENTITY_ID" */
  type: string;
}

export class SecureVault {
  private static store = new Map<string, string>();

  /**
   * Populates the vault with token→realValue mappings.
   * Clears any previous entries first (tab-scoped).
   */
  static populate(entries: VaultEntry[]): void {
    this.store.clear();
    for (const entry of entries) {
      if (entry.token && entry.realValue) {
        this.store.set(entry.token, entry.realValue);
      }
    }
  }

  /**
   * Adds a single entry to the vault without clearing existing entries.
   */
  static addEntry(entry: VaultEntry): void {
    if (entry.token && entry.realValue) {
      this.store.set(entry.token, entry.realValue);
    }
  }

  /**
   * Resolves a token to its real value.
   * Returns the token string itself if not found (safe fallback — won't fill wrong data).
   *
   * @param token - e.g. "<IDENTITY_ID>"
   * @returns real value or token string as fallback
   */
  static resolve(token: string): string {
    return this.store.get(token) ?? token;
  }

  /**
   * Checks if a given token exists in the vault.
   */
  static has(token: string): boolean {
    return this.store.has(token);
  }

  /**
   * Returns the number of entries in the vault.
   */
  static size(): number {
    return this.store.size;
  }

  /**
   * Clears all entries (call on tab close or task end).
   */
  static clear(): void {
    this.store.clear();
  }

  /**
   * Returns all tokens currently in the vault (for audit/debug — no real values exposed).
   */
  static getTokens(): string[] {
    return Array.from(this.store.keys());
  }
}
