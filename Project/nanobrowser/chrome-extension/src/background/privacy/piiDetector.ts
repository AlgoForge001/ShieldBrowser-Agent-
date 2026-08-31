/**
 * PII Detector — Privacy Shield Module
 *
 * Detects Personally Identifiable Information (PII) in text content
 * before it is sent to any LLM. Supports Indian government IDs and
 * common universal PII patterns.
 */

export enum PiiType {
  AADHAAR = 'AADHAAR',
  PAN = 'PAN',
  PASSPORT = 'PASSPORT',
  VOTER_ID = 'VOTER_ID',
  DRIVING_LICENSE = 'DRIVING_LICENSE',
  PHONE = 'PHONE',
  EMAIL = 'EMAIL',
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  BANK_ACCOUNT = 'BANK_ACCOUNT',
  IFSC = 'IFSC',
  UPI_ID = 'UPI_ID',
  IPV4 = 'IPV4',
  DATE_OF_BIRTH = 'DATE_OF_BIRTH',
  NAME_PREFIX = 'NAME_PREFIX',
}

export interface PiiMatch {
  type: PiiType;
  value: string;
  start: number;
  end: number;
  redactedWith: string;
}

export interface PiiDetectionResult {
  hasPii: boolean;
  matches: PiiMatch[];
  piiTypes: PiiType[];
}

/** Map of PII type to its regex pattern */
const PII_PATTERNS: Array<{ type: PiiType; pattern: RegExp }> = [
  // Aadhaar: 12 digit number in groups of 4 (with or without spaces/hyphens)
  {
    type: PiiType.AADHAAR,
    pattern: /\b[2-9]\d{3}[\s\-]?\d{4}[\s\-]?\d{4}\b/g,
  },

  // PAN Card: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)
  {
    type: PiiType.PAN,
    pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,
  },

  // Indian Passport: 1 letter + 7 digits (e.g. A1234567)
  {
    type: PiiType.PASSPORT,
    pattern: /\b[A-PR-WYa-pr-wy][1-9]\d\s?\d{4}[1-9]\b/g,
  },

  // Voter ID: 3 letters + 7 digits
  {
    type: PiiType.VOTER_ID,
    pattern: /\b[A-Z]{3}[0-9]{7}\b/g,
  },

  // Indian Driving License: State code + 13 digits
  {
    type: PiiType.DRIVING_LICENSE,
    pattern: /\b(DL|MH|KA|TN|AP|UP|GJ|RJ|HR|MP|WB|PB|KL|OD|AS|BR|JH|CG|UK|HP|JK|GA|MN|ML|MZ|NL|SK|TR|AR|DN|DD|LD|CH|PY|AN)-?\d{2}[\s-]?\d{11}\b/gi,
  },

  // Indian Phone numbers: +91 or 0 prefix or bare 10 digit starting with 6-9
  {
    type: PiiType.PHONE,
    pattern: /(?:\+91[\s\-]?|0)?[6-9]\d{9}\b/g,
  },

  // Email addresses
  {
    type: PiiType.EMAIL,
    pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
  },

  // Credit/Debit card: 13-19 digits optionally separated by spaces or hyphens
  {
    type: PiiType.CREDIT_CARD,
    pattern: /\b(?:\d{4}[\s\-]?){3}\d{4}\b/g,
  },

  // Bank Account Number: 9 to 18 digits
  {
    type: PiiType.BANK_ACCOUNT,
    pattern: /\b\d{9,18}\b/g,
  },

  // IFSC Code: 4 letters + 0 + 6 alphanumerics (e.g. SBIN0001234)
  {
    type: PiiType.IFSC,
    pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,
  },

  // UPI ID: user@bankname
  {
    type: PiiType.UPI_ID,
    pattern: /\b[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}\b/g,
  },

  // IPv4 addresses
  {
    type: PiiType.IPV4,
    pattern: /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
  },

  // Date of Birth: common formats DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
  {
    type: PiiType.DATE_OF_BIRTH,
    pattern: /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})\b/g,
  },
];

/**
 * Detects PII in the given text.
 * @param text - Raw text to scan
 * @returns Detection result with all matches and summary
 */
export function detectPii(text: string): PiiDetectionResult {
  if (!text || text.trim() === '') {
    return { hasPii: false, matches: [], piiTypes: [] };
  }

  const matches: PiiMatch[] = [];
  const piiTypesFound = new Set<PiiType>();

  for (const { type, pattern } of PII_PATTERNS) {
    // Reset lastIndex for global regex on each call
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      // Skip very short potential false positives for bank accounts
      if (type === PiiType.BANK_ACCOUNT && match[0].length < 10) {
        continue;
      }

      const redactedWith = `[REDACTED-${type}]`;
      matches.push({
        type,
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        redactedWith,
      });
      piiTypesFound.add(type);
    }
  }

  // Specificity priority: explicit types come before generic digit sequences
  const TYPE_PRIORITY: Record<PiiType, number> = {
    [PiiType.PAN]: 10,
    [PiiType.PASSPORT]: 10,
    [PiiType.VOTER_ID]: 10,
    [PiiType.DRIVING_LICENSE]: 10,
    [PiiType.EMAIL]: 10,
    [PiiType.UPI_ID]: 9,
    [PiiType.CREDIT_CARD]: 8,
    [PiiType.DEBIT_CARD]: 8,
    [PiiType.AADHAAR]: 7,
    [PiiType.PHONE]: 6,
    [PiiType.IFSC]: 5,
    [PiiType.IPV4]: 5,
    [PiiType.DATE_OF_BIRTH]: 4,
    [PiiType.NAME_PREFIX]: 3,
    [PiiType.BANK_ACCOUNT]: 1, // Generic digits lowest priority
  };

  // Sort matches: longest first, then highest priority
  matches.sort((a, b) => {
    const lenDiff = (b.end - b.start) - (a.end - a.start);
    if (lenDiff !== 0) return lenDiff;
    return (TYPE_PRIORITY[b.type] ?? 0) - (TYPE_PRIORITY[a.type] ?? 0);
  });

  // Filter out any matches that are subsumed or overlap with a higher priority / longer match
  const nonOverlappingMatches: PiiMatch[] = [];
  for (const m of matches) {
    const overlaps = nonOverlappingMatches.some(
      existing => m.start < existing.end && m.end > existing.start,
    );
    if (!overlaps) {
      nonOverlappingMatches.push(m);
    }
  }

  // Sort final matches by start index for ordered text processing
  nonOverlappingMatches.sort((a, b) => a.start - b.start);

  const finalTypes = Array.from(new Set(nonOverlappingMatches.map(m => m.type)));

  return {
    hasPii: nonOverlappingMatches.length > 0,
    matches: nonOverlappingMatches,
    piiTypes: finalTypes,
  };
}

/**
 * Quick check — returns true if any PII is found in the text.
 */
export function hasPii(text: string): boolean {
  return detectPii(text).hasPii;
}
