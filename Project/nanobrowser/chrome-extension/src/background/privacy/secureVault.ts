/**
 * Secure Vault — Privacy Shadow Token Store
 *
 * Maintains a tab-scoped, in-memory mapping of semantic tokens → real PII values.
 *
 * Sources (merged in priority order — DOM value > stored credential):
 *   1. DOM scan values captured live from the page fields (before masking)
 *   2. User's pre-stored credentials from credentialStore (AES-GCM encrypted)
 *
 * Used by TokenResolver to substitute real values back into AI-generated actions
 * immediately before DOM execution.
 *
 * Security properties:
 *   - In-memory only (Map<>) — never written to disk
 *   - Tab-scoped: cleared at the start of each new scan
 *   - Never sent to server — VLM only ever receives semantic token strings
 *   - Only tokenResolver.ts can call resolve() — no external API
 */

import { getAllCredentials, getDecryptedValue } from './credentialStore';

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
    const direct = this.store.get(token);
    if (direct !== undefined) return direct;
    const upper = token.toUpperCase();
    const upperMatch = this.store.get(upper);
    if (upperMatch !== undefined) return upperMatch;
    return token;
  }

  /**
   * Checks if a given token exists in the vault.
   */
  static has(token: string): boolean {
    return this.store.has(token) || this.store.has(token.toUpperCase());
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

  /**
   * Loads ALL user-stored credentials from the encrypted credentialStore into the
   * in-memory vault. DOM-captured values take priority — if the vault already has
   * an entry for a token (from DOM scan), the stored credential does NOT overwrite it.
   *
   * Call this AFTER populate() so DOM values win over stored values.
   */
  static async loadFromCredentialStore(): Promise<void> {
    try {
      const allEntries = await getAllCredentials();
      for (const entry of allEntries) {
        const token = `<${entry.tokenType}>`;
        const realValue = await getDecryptedValue(entry.id);
        if (!realValue) continue;

        // Add main token if not present
        if (!this.store.has(token)) {
          this.store.set(token, realValue);
        }

        // Add common aliases so LLM outputs always match
        const aliasMap: Record<string, string[]> = {
          IDENTITY_ID: ['<AADHAAR>', '<AADHAAR_NUMBER>', '<AADHAR>', '<AADHAR_NUMBER>', '<ID_CARD>', '<NATIONAL_ID>'],
          TAX_ID: ['<PAN>', '<PAN_CARD>', '<PAN_NUMBER>'],
          CREDENTIAL: ['<PASSWORD>', '<PIN>', '<PASSCODE>'],
          PHONE: ['<PHONE_NUMBER>', '<MOBILE>', '<MOBILE_NUMBER>'],
          EMAIL: ['<EMAIL_ADDRESS>'],
          BANK_ACCOUNT: ['<ACCOUNT_NUMBER>', '<BANK_ACC>'],
          UPI_ID: ['<UPI>', '<VPA>'],
          IFSC: ['<IFSC_CODE>'],
        };

        const aliases = aliasMap[entry.tokenType] || [];
        for (const alias of aliases) {
          if (!this.store.has(alias)) {
            this.store.set(alias, realValue);
          }
        }

        // Also add custom label token if available
        if (entry.label) {
          const sanitizedLabel = entry.label.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
          const customToken = `<${sanitizedLabel}>`;
          if (!this.store.has(customToken)) {
            this.store.set(customToken, realValue);
          }
        }
      }
    } catch (err) {
      // Non-fatal — vault may be empty or key derivation may fail on first run
      console.warn('[SecureVault] loadFromCredentialStore failed (non-fatal):', err);
    }
  }

  /**
   * Returns true if the vault has any entries (from DOM or credential store).
   */
  static isPopulated(): boolean {
    return this.store.size > 0;
  }
}
