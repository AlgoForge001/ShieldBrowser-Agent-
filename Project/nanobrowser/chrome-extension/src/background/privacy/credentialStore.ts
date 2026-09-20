/**
 * Credential Store — Personal Vault
 *
 * Persists user-supplied credentials locally using chrome.storage.local.
 * All values are encrypted with AES-GCM 256-bit before writing to storage.
 *
 * Security properties:
 *   - Encrypted at rest: AES-GCM with a key derived from the extension ID
 *   - Device-local: chrome.storage.local never syncs to Chrome account
 *   - Zero server egress: Only TokenResolver reads real values, nothing else
 *   - Masked display: UI shows only a hint (last 4 chars), never the full value
 *
 * Token types map exactly to Privacy Shadow tokens used in the Vision Pipeline:
 *   CREDENTIAL  → <CREDENTIAL>
 *   IDENTITY_ID → <IDENTITY_ID>  (Aadhaar)
 *   TAX_ID      → <TAX_ID>       (PAN)
 *   ...etc
 */

const STORAGE_KEY = 'shieldbrowse_vault_v1';
const CRYPTO_SALT = 'shieldbrowse-vault-salt-v1';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TokenType =
  | 'CREDENTIAL'
  | 'IDENTITY_ID'
  | 'TAX_ID'
  | 'OTP'
  | 'CARD_NUMBER'
  | 'CARD_SECURITY'
  | 'PHONE'
  | 'EMAIL'
  | 'BANK_ACCOUNT'
  | 'UPI_ID'
  | 'IFSC';

export interface CredentialEntry {
  id: string;             // UUID
  label: string;          // user-facing name, e.g. "HDFC Bank Password"
  tokenType: TokenType;   // maps to Privacy Shadow token
  encryptedValue: string; // base64(iv + ciphertext)
  hint: string;           // last 4 chars of real value, shown in UI (e.g. "•••• 1012")
  createdAt: number;      // unix ms
}

/** Serialised form stored in chrome.storage.local */
interface VaultStorage {
  entries: CredentialEntry[];
}

// ─── Crypto helpers ───────────────────────────────────────────────────────────

/**
 * Derives a stable AES-GCM key from the extension's install ID.
 * The key is non-extractable and tied to this device/install.
 */
async function deriveKey(): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(chrome.runtime.id + CRYPTO_SALT);
  const keyMaterial = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(CRYPTO_SALT),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,          // non-extractable
    ['encrypt', 'decrypt'],
  );
}

async function encryptValue(plaintext: string): Promise<string> {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

async function decryptValue(encrypted: string): Promise<string> {
  const key = await deriveKey();
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

function makeHint(value: string): string {
  if (value.length <= 4) return '••••';
  return '•'.repeat(Math.min(value.length - 4, 8)) + value.slice(-4);
}

function makeId(): string {
  return `cred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function readStorage(): Promise<VaultStorage> {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEY, result => {
      const data = result[STORAGE_KEY] as VaultStorage | undefined;
      resolve(data ?? { entries: [] });
    });
  });
}

async function writeStorage(vault: VaultStorage): Promise<void> {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY]: vault }, resolve);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Saves a new credential (or updates one with the same id).
 * The real value is encrypted before storage; only the hint is stored in plaintext.
 */
export async function saveCredential(
  label: string,
  tokenType: TokenType,
  realValue: string,
  existingId?: string,
): Promise<CredentialEntry> {
  const vault = await readStorage();
  const encrypted = await encryptValue(realValue);
  const hint = makeHint(realValue);
  const id = existingId ?? makeId();

  const entry: CredentialEntry = {
    id,
    label,
    tokenType,
    encryptedValue: encrypted,
    hint,
    createdAt: Date.now(),
  };

  const idx = vault.entries.findIndex(e => e.id === id);
  if (idx >= 0) {
    vault.entries[idx] = entry;
  } else {
    vault.entries.push(entry);
  }

  await writeStorage(vault);
  return entry;
}

/**
 * Returns all stored credential entries (without decrypting — UI only needs hints).
 */
export async function getAllCredentials(): Promise<CredentialEntry[]> {
  const vault = await readStorage();
  return vault.entries;
}

/**
 * Decrypts and returns the real value for a credential by its id.
 */
export async function getDecryptedValue(id: string): Promise<string | null> {
  const vault = await readStorage();
  const entry = vault.entries.find(e => e.id === id);
  if (!entry) return null;
  try {
    return await decryptValue(entry.encryptedValue);
  } catch {
    return null;
  }
}

/**
 * Returns the first entry matching a given token type with its decrypted value.
 * Used by SecureVault to pre-load user credentials into the in-memory session vault.
 */
export async function getDecryptedByTokenType(
  tokenType: TokenType,
): Promise<Array<{ entry: CredentialEntry; realValue: string }>> {
  const vault = await readStorage();
  const matching = vault.entries.filter(e => e.tokenType === tokenType);
  const results: Array<{ entry: CredentialEntry; realValue: string }> = [];
  for (const entry of matching) {
    try {
      const realValue = await decryptValue(entry.encryptedValue);
      results.push({ entry, realValue });
    } catch {
      // Skip corrupted entries silently
    }
  }
  return results;
}

/**
 * Deletes a credential by id.
 */
export async function deleteCredential(id: string): Promise<void> {
  const vault = await readStorage();
  vault.entries = vault.entries.filter(e => e.id !== id);
  await writeStorage(vault);
}

/**
 * Wipes all stored credentials. Irreversible.
 */
export async function clearAllCredentials(): Promise<void> {
  await writeStorage({ entries: [] });
}

export const credentialStore = {
  save: saveCredential,
  getAll: getAllCredentials,
  getDecryptedValue,
  getDecryptedByTokenType,
  delete: deleteCredential,
  clearAll: clearAllCredentials,
};
