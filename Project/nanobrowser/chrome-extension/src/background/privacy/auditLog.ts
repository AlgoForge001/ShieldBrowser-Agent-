/**
 * Privacy Audit Log — Privacy Shield Module
 *
 * Tracks every redaction event in memory (session-scoped).
 * Entries are available for the side panel to display in real time.
 * Nothing is persisted to disk — privacy-first design.
 */

import { type PiiType } from './piiDetector';

export interface AuditEntry {
  /** Unique sequential ID */
  id: number;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** URL of the page where PII was detected */
  pageUrl: string;
  /** Page title at time of detection */
  pageTitle: string;
  /** Which PII types were found */
  piiTypes: PiiType[];
  /** How many individual PII items were redacted */
  redactedCount: number;
  /** Context: where in the pipeline was this caught */
  source: AuditSource;
}

export enum AuditSource {
  /** PII found in page DOM text / interactive elements */
  DOM_TEXT = 'DOM_TEXT',
  /** PII found in page URL or query parameters */
  URL = 'URL',
  /** PII found in page title */
  TITLE = 'TITLE',
  /** PII found in action results returned to LLM */
  ACTION_RESULT = 'ACTION_RESULT',
}

export interface AuditSummary {
  totalEntries: number;
  totalRedacted: number;
  piiTypeCounts: Record<string, number>;
  firstDetectedAt: string | null;
  lastDetectedAt: string | null;
}

class PrivacyAuditLog {
  private entries: AuditEntry[] = [];
  private counter = 0;
  private listeners: Array<(entry: AuditEntry) => void> = [];

  /**
   * Record a new redaction event.
   */
  record(params: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
    const entry: AuditEntry = {
      id: ++this.counter,
      timestamp: new Date().toISOString(),
      ...params,
    };
    this.entries.push(entry);
    // Notify all listeners (e.g., side panel)
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // ignore listener errors
      }
    }
    return entry;
  }

  /**
   * Get all audit entries (newest first).
   */
  getEntries(): AuditEntry[] {
    return [...this.entries].reverse();
  }

  /**
   * Get a high-level summary of the session's audit log.
   */
  getSummary(): AuditSummary {
    const piiTypeCounts: Record<string, number> = {};

    for (const entry of this.entries) {
      for (const piiType of entry.piiTypes) {
        piiTypeCounts[piiType] = (piiTypeCounts[piiType] ?? 0) + entry.redactedCount;
      }
    }

    const timestamps = this.entries.map(e => e.timestamp).sort();

    return {
      totalEntries: this.entries.length,
      totalRedacted: this.entries.reduce((sum, e) => sum + e.redactedCount, 0),
      piiTypeCounts,
      firstDetectedAt: timestamps[0] ?? null,
      lastDetectedAt: timestamps[timestamps.length - 1] ?? null,
    };
  }

  /**
   * Register a listener to be called on every new audit entry.
   * Used by the side panel to update in real time.
   */
  subscribe(listener: (entry: AuditEntry) => void): () => void {
    this.listeners.push(listener);
    // Return an unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Clear all entries (e.g., on new browsing session).
   */
  clear(): void {
    this.entries = [];
    this.counter = 0;
  }

  /**
   * Get the count of redacted items in this session.
   */
  get totalRedacted(): number {
    return this.entries.reduce((sum, e) => sum + e.redactedCount, 0);
  }

  /**
   * Get unique PII types seen in this session.
   */
  get piiTypesSeen(): PiiType[] {
    const seen = new Set<PiiType>();
    for (const entry of this.entries) {
      for (const t of entry.piiTypes) {
        seen.add(t);
      }
    }
    return Array.from(seen);
  }
}

/** Singleton audit log instance shared across the extension background */
export const privacyAuditLog = new PrivacyAuditLog();
