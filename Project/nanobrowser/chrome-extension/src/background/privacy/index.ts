/**
 * Privacy Shield — Public API
 *
 * Re-exports everything needed by the agent pipeline.
 */

export { detectPii, hasPii, PiiType, getPiiPatternDefs } from './piiDetector';
export type { PiiMatch, PiiDetectionResult, PiiPatternDef } from './piiDetector';

export {
  redactText,
  redactDomContext,
  redactUrl,
  redactTitle,
  redactObjectStrings,
  describeRedaction,
  createRedactionStats,
  accumulateStats,
} from './piiRedactor';
export type { RedactionResult, RedactionStats } from './piiRedactor';

export { privacyAuditLog, AuditSource } from './auditLog';
export type { AuditEntry, AuditSummary } from './auditLog';

export { SecureVault } from './secureVault';
export type { VaultEntry } from './secureVault';

export { TokenResolver } from './tokenResolver';

export {
  stripZeroWidth,
  sanitizePromptInjection,
  wrapUntrustedContext,
  sanitizeAndWrapDom,
} from './ipiSanitizer';
export type { IpiSanitizationResult } from './ipiSanitizer';

export { EgressSigner, signRedactedFrame } from './egressSigner';
export type { SignedManifest, RedactedRegionInfo } from './egressSigner';

export {
  credentialStore,
  saveCredential,
  getAllCredentials,
  getDecryptedValue,
  getDecryptedByTokenType,
  deleteCredential,
  clearAllCredentials,
} from './credentialStore';
export type { CredentialEntry, TokenType } from './credentialStore';
