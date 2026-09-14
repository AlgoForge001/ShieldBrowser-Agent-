/**
 * Egress Signer — Vitest Test Suite
 * Tests: ECDSA P-256 signing, SHA-256 frame hashing, signed manifest structure,
 * and tamper detection.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EgressSigner, signRedactedFrame } from "../egressSigner";

describe("EgressSigner — Hashing & Signing", () => {
  beforeEach(() => {
    EgressSigner.resetKeys();
  });

  it("computes deterministic SHA-256 hash", async () => {
    const data = "sanitized-base64-image-data";
    const hash1 = await EgressSigner.computeHash(data);
    const hash2 = await EgressSigner.computeHash(data);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex length
  });

  it("produces a valid SignedManifest with ECDSA P-256 signature", async () => {
    const dummyImageB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const regions = [
      { x: 10, y: 20, width: 100, height: 30, type: "IDENTITY_ID" },
      { x: 50, y: 80, width: 80, height: 80, type: "FACE" },
    ];

    const manifest = await signRedactedFrame(dummyImageB64, regions);

    expect(manifest.algorithm).toBe("ECDSA-P256-SHA256");
    expect(manifest.regionsCount).toBe(2);
    expect(manifest.regions).toHaveLength(2);
    expect(manifest.nonce).toBeDefined();
    expect(manifest.frameHash).toBeDefined();
    expect(manifest.signature).toBeDefined();
    expect(manifest.signature.length).toBeGreaterThan(20);

    // Verify the signature using the session public key
    const isValid = await EgressSigner.verifyManifest(manifest);
    expect(isValid).toBe(true);
  });

  it("detects tampering when frame hash is modified", async () => {
    const dummyImageB64 = "valid-image-content";
    const manifest = await signRedactedFrame(dummyImageB64, []);

    // Tamper with frameHash
    const tamperedManifest = {
      ...manifest,
      frameHash: "0000000000000000000000000000000000000000000000000000000000000000",
    };

    const isValid = await EgressSigner.verifyManifest(tamperedManifest);
    expect(isValid).toBe(false);
  });

  it("detects tampering when region count is modified", async () => {
    const dummyImageB64 = "valid-image-content";
    const manifest = await signRedactedFrame(dummyImageB64, [
      { x: 0, y: 0, width: 50, height: 50 },
    ]);

    // Attacker modifies regions count
    const tamperedManifest = {
      ...manifest,
      regionsCount: 0,
    };

    const isValid = await EgressSigner.verifyManifest(tamperedManifest);
    expect(isValid).toBe(false);
  });
});
