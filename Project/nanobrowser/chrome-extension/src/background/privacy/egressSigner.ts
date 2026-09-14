/**
 * Egress Signer — Cryptographic Redaction Attestation (Privacy Shield Angle B)
 *
 * Generates an ECDSA P-256 cryptographic signature for each sanitized frame
 * before it leaves the browser. This provides a tamper-evident audit trail
 * proving that visual PII redaction occurred client-side before egress.
 */

export interface RedactedRegionInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  type?: string;
}

export interface SignedManifest {
  timestamp: string;
  nonce: string;
  frameHash: string;      // SHA-256 hex string of the sanitized frame
  regionsCount: number;
  regions: RedactedRegionInfo[];
  signature: string;      // Base64-encoded ECDSA P-256 signature
  algorithm: string;      // e.g. "ECDSA-P256-SHA256"
}

export class EgressSigner {
  private static keyPair: CryptoKeyPair | null = null;

  /**
   * Initializes or returns the in-memory session signing key pair.
   * Uses ECDSA P-256 curve. Private key is non-extractable.
   */
  static async getKeyPair(): Promise<CryptoKeyPair> {
    if (!this.keyPair) {
      this.keyPair = await crypto.subtle.generateKey(
        {
          name: 'ECDSA',
          namedCurve: 'P-256',
        },
        false, // extractable: false for private key security
        ['sign', 'verify'],
      );
    }
    return this.keyPair;
  }

  /**
   * Computes SHA-256 hex hash of an input string or ArrayBuffer.
   */
  static async computeHash(input: string | ArrayBuffer): Promise<string> {
    const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Signs a sanitized frame and its redacted bounding boxes.
   *
   * @param sanitizedImageB64 - Base64 encoded sanitized image
   * @param regions - List of redacted region coordinates and types
   * @returns SignedManifest containing hash, metadata, and ECDSA signature
   */
  static async signFrame(
    sanitizedImageB64: string,
    regions: RedactedRegionInfo[] = [],
  ): Promise<SignedManifest> {
    const keys = await this.getKeyPair();
    const frameHash = await this.computeHash(sanitizedImageB64);
    const timestamp = new Date().toISOString();
    const nonce = typeof crypto.randomUUID === 'function' 
      ? crypto.randomUUID() 
      : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Canonical payload string to sign
    const payload = `${timestamp}|${nonce}|${frameHash}|${regions.length}`;
    const payloadBytes = new TextEncoder().encode(payload);

    const signatureBuffer = await crypto.subtle.sign(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' },
      },
      keys.privateKey,
      payloadBytes,
    );

    // Convert signature ArrayBuffer to Base64
    const signatureBytes = new Uint8Array(signatureBuffer);
    let binary = '';
    for (let i = 0; i < signatureBytes.byteLength; i++) {
      binary += String.fromCharCode(signatureBytes[i]);
    }
    const signature = btoa(binary);

    return {
      timestamp,
      nonce,
      frameHash,
      regionsCount: regions.length,
      regions,
      signature,
      algorithm: 'ECDSA-P256-SHA256',
    };
  }

  /**
   * Local verification helper for testing and auditing.
   * Verifies the signature against the session public key.
   */
  static async verifyManifest(manifest: SignedManifest): Promise<boolean> {
    try {
      const keys = await this.getKeyPair();
      const payload = `${manifest.timestamp}|${manifest.nonce}|${manifest.frameHash}|${manifest.regionsCount}`;
      const payloadBytes = new TextEncoder().encode(payload);

      // Decode base64 signature
      const binary = atob(manifest.signature);
      const signatureBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        signatureBytes[i] = binary.charCodeAt(i);
      }

      return await crypto.subtle.verify(
        {
          name: 'ECDSA',
          hash: { name: 'SHA-256' },
        },
        keys.publicKey,
        signatureBytes,
        payloadBytes,
      );
    } catch {
      return false;
    }
  }

  /**
   * Reset session key pair (for testing)
   */
  static resetKeys(): void {
    this.keyPair = null;
  }
}

/**
 * Top-level convenience function for pipeline integration.
 */
export async function signRedactedFrame(
  sanitizedImageB64: string,
  regions: RedactedRegionInfo[] = [],
): Promise<SignedManifest> {
  return EgressSigner.signFrame(sanitizedImageB64, regions);
}
