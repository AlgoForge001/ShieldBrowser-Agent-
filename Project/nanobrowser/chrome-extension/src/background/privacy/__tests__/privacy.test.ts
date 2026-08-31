/**
 * Privacy Shield — Vitest Test Suite
 * Tests: piiDetector, piiRedactor, auditLog
 */

import { describe, it, expect, beforeEach } from "vitest";
import { detectPii, hasPii, PiiType } from "../piiDetector";
import {
  redactText,
  redactUrl,
  redactTitle,
  redactObjectStrings,
  describeRedaction,
  createRedactionStats,
  accumulateStats,
} from "../piiRedactor";
import { privacyAuditLog, AuditSource } from "../auditLog";

// ─── detectPii ───────────────────────────────────────────────────────────────

describe("detectPii — empty / safe input", () => {
  it("returns no PII for empty string", () => {
    const r = detectPii("");
    expect(r.hasPii).toBe(false);
    expect(r.matches).toHaveLength(0);
  });
  it("returns no PII for whitespace-only string", () => {
    expect(detectPii("   \t\n  ").hasPii).toBe(false);
  });
  it("returns no PII for safe text", () => {
    expect(detectPii("The quick brown fox jumps over the lazy dog.").hasPii).toBe(false);
  });
});

describe("detectPii — Aadhaar", () => {
  it("detects Aadhaar with spaces", () => {
    const r = detectPii("aadhaar: 5482 1234 5678");
    expect(r.hasPii).toBe(true);
    expect(r.piiTypes).toContain(PiiType.AADHAAR);
  });
  it("detects Aadhaar with hyphens", () => {
    expect(detectPii("5482-1234-5678").piiTypes).toContain(PiiType.AADHAAR);
  });
  it("does NOT detect number starting with 0 or 1 as Aadhaar", () => {
    expect(detectPii("0123 4567 8901").piiTypes).not.toContain(PiiType.AADHAAR);
  });
});

describe("detectPii — PAN Card", () => {
  it("detects valid PAN", () => {
    expect(detectPii("PAN: ABCDE1234F submitted.").piiTypes).toContain(PiiType.PAN);
  });
  it("detects PAN embedded in sentence", () => {
    expect(detectPii("Filing ITR with ZYXWV9876A this year.").piiTypes).toContain(PiiType.PAN);
  });
});

describe("detectPii — Phone", () => {
  it("detects +91 prefix phone", () => {
    expect(detectPii("Call +91 9876543210 now.").piiTypes).toContain(PiiType.PHONE);
  });
  it("detects bare 10-digit mobile starting with 9", () => {
    expect(detectPii("Mobile: 9123456789").piiTypes).toContain(PiiType.PHONE);
  });
});

describe("detectPii — Email", () => {
  it("detects standard email", () => {
    expect(detectPii("user.name@domain.com").piiTypes).toContain(PiiType.EMAIL);
  });
  it("detects email with subdomain", () => {
    expect(detectPii("admin@sub.example.co.in").piiTypes).toContain(PiiType.EMAIL);
  });
});

describe("detectPii — Credit Card", () => {
  it("detects 16-digit card with spaces", () => {
    expect(detectPii("4111 2222 3333 4444").piiTypes).toContain(PiiType.CREDIT_CARD);
  });
  it("detects card with hyphens", () => {
    expect(detectPii("4111-2222-3333-4444").piiTypes).toContain(PiiType.CREDIT_CARD);
  });
});

describe("detectPii — IFSC", () => {
  it("detects valid IFSC", () => {
    expect(detectPii("IFSC: SBIN0001234 for NEFT.").piiTypes).toContain(PiiType.IFSC);
  });
});

describe("detectPii — IPv4", () => {
  it("detects IPv4 address", () => {
    expect(detectPii("Server at 192.168.1.100 responded.").piiTypes).toContain(PiiType.IPV4);
  });
});

describe("detectPii — Date of Birth", () => {
  it("detects DD/MM/YYYY format", () => {
    expect(detectPii("DOB: 15/08/1990").piiTypes).toContain(PiiType.DATE_OF_BIRTH);
  });
  it("detects YYYY-MM-DD format", () => {
    expect(detectPii("Born on 1990-08-15.").piiTypes).toContain(PiiType.DATE_OF_BIRTH);
  });
});

describe("detectPii — multiple types + non-overlapping", () => {
  it("detects phone and email together", () => {
    const r = detectPii("Contact +91 9876543210 or user@example.com for support.");
    expect(r.piiTypes).toContain(PiiType.PHONE);
    expect(r.piiTypes).toContain(PiiType.EMAIL);
  });
  it("returns non-overlapping matches", () => {
    const r = detectPii("PAN: ABCDE1234F, Email: user@example.com");
    for (let i = 0; i < r.matches.length; i++) {
      for (let j = i + 1; j < r.matches.length; j++) {
        const { start: s1, end: e1 } = r.matches[i];
        const { start: s2, end: e2 } = r.matches[j];
        expect(s1 >= e2 || s2 >= e1).toBe(true);
      }
    }
  });
});

describe("hasPii helper", () => {
  it("returns true when PII present", () => {
    expect(hasPii("my aadhaar 5482 1234 5678")).toBe(true);
  });
  it("returns false when no PII", () => {
    expect(hasPii("hello world")).toBe(false);
  });
});

// ─── redactText ──────────────────────────────────────────────────────────────

describe("redactText — Aadhaar", () => {
  it("replaces Aadhaar with token", () => {
    const r = redactText("User aadhaar is 5482 1234 5678 and registered.");
    expect(r.wasRedacted).toBe(true);
    expect(r.redacted).toContain("[REDACTED-AADHAAR]");
    expect(r.redacted).not.toContain("5482 1234 5678");
  });
});

describe("redactText — PAN", () => {
  it("replaces PAN with token", () => {
    const r = redactText("PAN: ABCDE1234F submitted for KYC.");
    expect(r.redacted).toContain("[REDACTED-PAN]");
    expect(r.redacted).not.toContain("ABCDE1234F");
  });
});

describe("redactText — Phone + Email", () => {
  it("redacts both phone and email", () => {
    const r = redactText("Contact at +91 9876543210 or user.name@domain.com.");
    expect(r.redacted).toContain("[REDACTED-PHONE]");
    expect(r.redacted).toContain("[REDACTED-EMAIL]");
    expect(r.redacted).not.toContain("9876543210");
    expect(r.redacted).not.toContain("user.name@domain.com");
  });
});

describe("redactText — safe text", () => {
  it("does not modify text without PII", () => {
    const input = "Hello world, everything is fine.";
    const r = redactText(input);
    expect(r.wasRedacted).toBe(false);
    expect(r.redacted).toBe(input);
  });
});

describe("redactText — preserves surrounding text", () => {
  it("keeps non-PII context intact", () => {
    const r = redactText("Name: John, Email: john@example.com, Status: Active");
    expect(r.redacted).toContain("Name: John");
    expect(r.redacted).toContain("Status: Active");
    expect(r.redacted).not.toContain("john@example.com");
  });
});

// ─── redactUrl ───────────────────────────────────────────────────────────────

describe("redactUrl", () => {
  it("redacts PAN from query param", () => {
    expect(redactUrl("https://portal.gov.in/kyc?pan=ABCDE1234F")).not.toContain("ABCDE1234F");
  });
  it("redacts email from query param", () => {
    expect(redactUrl("https://example.com/profile?email=john@test.com")).not.toContain("john@test.com");
  });
  it("redacts phone from query param", () => {
    expect(redactUrl("https://example.com/otp?phone=9876543210")).not.toContain("9876543210");
  });
  it("preserves host and path structure", () => {
    const r = redactUrl("https://portal.gov.in/kyc?pan=ABCDE1234F");
    expect(r).toContain("portal.gov.in");
    expect(r).toContain("/kyc");
  });
  it("handles non-URL strings gracefully", () => {
    expect(redactUrl("not a url but has ABCDE1234F inside")).not.toContain("ABCDE1234F");
  });
});

// ─── redactTitle ─────────────────────────────────────────────────────────────

describe("redactTitle", () => {
  it("redacts PAN from title", () => {
    const r = redactTitle("Profile: ABCDE1234F — My Account");
    expect(r).not.toContain("ABCDE1234F");
    expect(r).toContain("[REDACTED-PAN]");
  });
  it("returns safe title unchanged", () => {
    expect(redactTitle("Welcome to Your Dashboard")).toBe("Welcome to Your Dashboard");
  });
});

// ─── redactObjectStrings ─────────────────────────────────────────────────────

describe("redactObjectStrings", () => {
  it("redacts PII in string fields", () => {
    const obj = { name: "John", pan: "ABCDE1234F", age: 30, active: true };
    const r = redactObjectStrings(obj);
    expect(r.pan).not.toContain("ABCDE1234F");
    expect(r.name).toBe("John");
    expect(r.age).toBe(30);
    expect(r.active).toBe(true);
  });
  it("does not mutate the original object", () => {
    const obj = { email: "user@example.com" };
    redactObjectStrings(obj);
    expect(obj.email).toBe("user@example.com");
  });
});

// ─── describeRedaction ────────────────────────────────────────────────────────

describe("describeRedaction", () => {
  it('returns "No PII detected" for non-redacted', () => {
    expect(describeRedaction(redactText("Hello world"))).toBe("No PII detected");
  });
  it("returns count and type for redacted result", () => {
    const desc = describeRedaction(redactText("PAN: ABCDE1234F"));
    expect(desc).toContain("Redacted");
    expect(desc).toContain("PAN");
  });
});

// ─── RedactionStats ───────────────────────────────────────────────────────────

describe("Redaction stats accumulation", () => {
  it("accumulates correctly across multiple calls", () => {
    const stats = createRedactionStats();
    accumulateStats(stats, redactText("PAN: ABCDE1234F"));
    accumulateStats(stats, redactText("Hello safe text"));
    accumulateStats(stats, redactText("Email: user@example.com"));
    expect(stats.totalScanned).toBe(3);
    expect(stats.totalRedacted).toBe(2);
    expect(stats.piiTypesEncountered.has(PiiType.PAN)).toBe(true);
    expect(stats.piiTypesEncountered.has(PiiType.EMAIL)).toBe(true);
  });
});

// ─── PrivacyAuditLog ──────────────────────────────────────────────────────────

describe("PrivacyAuditLog", () => {
  beforeEach(() => { privacyAuditLog.clear(); });

  it("records an entry and returns it", () => {
    const entry = privacyAuditLog.record({
      pageUrl: "https://example.com/checkout",
      pageTitle: "Checkout",
      piiTypes: [PiiType.CREDIT_CARD],
      redactedCount: 1,
      source: AuditSource.DOM_TEXT,
    });
    expect(entry.id).toBeGreaterThan(0);
    expect(entry.piiTypes).toContain(PiiType.CREDIT_CARD);
    expect(entry.timestamp).toBeTruthy();
  });

  it("getEntries returns newest first", () => {
    privacyAuditLog.record({ pageUrl: "https://a.com", pageTitle: "A", piiTypes: [PiiType.EMAIL], redactedCount: 1, source: AuditSource.URL });
    privacyAuditLog.record({ pageUrl: "https://b.com", pageTitle: "B", piiTypes: [PiiType.PAN],   redactedCount: 2, source: AuditSource.DOM_TEXT });
    const entries = privacyAuditLog.getEntries();
    expect(entries[0].pageUrl).toBe("https://b.com");
    expect(entries[1].pageUrl).toBe("https://a.com");
  });

  it("getSummary aggregates stats", () => {
    privacyAuditLog.record({ pageUrl: "https://a.com", pageTitle: "A", piiTypes: [PiiType.PAN],   redactedCount: 3, source: AuditSource.DOM_TEXT });
    privacyAuditLog.record({ pageUrl: "https://b.com", pageTitle: "B", piiTypes: [PiiType.EMAIL], redactedCount: 2, source: AuditSource.URL });
    const s = privacyAuditLog.getSummary();
    expect(s.totalEntries).toBe(2);
    expect(s.totalRedacted).toBe(5);
    expect(s.piiTypeCounts[PiiType.PAN]).toBe(3);
    expect(s.piiTypeCounts[PiiType.EMAIL]).toBe(2);
  });

  it("subscribe notifies listener on record", () => {
    let triggered = false;
    const unsubscribe = privacyAuditLog.subscribe(e => {
      triggered = true;
      expect(e.piiTypes).toContain(PiiType.AADHAAR);
    });
    privacyAuditLog.record({ pageUrl: "https://example.com", pageTitle: "Test", piiTypes: [PiiType.AADHAAR], redactedCount: 1, source: AuditSource.DOM_TEXT });
    expect(triggered).toBe(true);
    unsubscribe();
  });

  it("unsubscribe removes listener", () => {
    let callCount = 0;
    const unsubscribe = privacyAuditLog.subscribe(() => { callCount++; });
    privacyAuditLog.record({ pageUrl: "https://a.com", pageTitle: "A", piiTypes: [PiiType.EMAIL], redactedCount: 1, source: AuditSource.DOM_TEXT });
    unsubscribe();
    privacyAuditLog.record({ pageUrl: "https://b.com", pageTitle: "B", piiTypes: [PiiType.PAN],   redactedCount: 1, source: AuditSource.DOM_TEXT });
    expect(callCount).toBe(1);
  });

  it("clear resets all entries", () => {
    privacyAuditLog.record({ pageUrl: "https://a.com", pageTitle: "A", piiTypes: [PiiType.PAN], redactedCount: 1, source: AuditSource.DOM_TEXT });
    privacyAuditLog.clear();
    expect(privacyAuditLog.getSummary().totalEntries).toBe(0);
    expect(privacyAuditLog.getSummary().totalRedacted).toBe(0);
  });

  it("totalRedacted getter sums correctly", () => {
    privacyAuditLog.record({ pageUrl: "https://a.com", pageTitle: "A", piiTypes: [PiiType.PAN],   redactedCount: 4, source: AuditSource.DOM_TEXT });
    privacyAuditLog.record({ pageUrl: "https://b.com", pageTitle: "B", piiTypes: [PiiType.EMAIL], redactedCount: 6, source: AuditSource.DOM_TEXT });
    expect(privacyAuditLog.totalRedacted).toBe(10);
  });

  it("piiTypesSeen returns unique types across entries", () => {
    privacyAuditLog.record({ pageUrl: "https://a.com", pageTitle: "A", piiTypes: [PiiType.PAN, PiiType.EMAIL], redactedCount: 2, source: AuditSource.DOM_TEXT });
    privacyAuditLog.record({ pageUrl: "https://b.com", pageTitle: "B", piiTypes: [PiiType.PAN],                redactedCount: 1, source: AuditSource.DOM_TEXT });
    const seen = privacyAuditLog.piiTypesSeen;
    expect(seen).toContain(PiiType.PAN);
    expect(seen).toContain(PiiType.EMAIL);
    expect(seen.filter(t => t === PiiType.PAN)).toHaveLength(1);
  });
});
