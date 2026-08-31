/**
 * Privacy Shield — Public API
 *
 * Re-exports everything needed by the agent pipeline.
 */

export { detectPii, hasPii, PiiType } from './piiDetector';
export type { PiiMatch, PiiDetectionResult } from './piiDetector';

export {
  redactText,
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
