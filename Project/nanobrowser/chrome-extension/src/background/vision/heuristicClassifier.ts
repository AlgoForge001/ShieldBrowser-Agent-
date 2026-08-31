/**
 * Heuristic Screen Classifier
 *
 * Zero-millisecond URL + DOM pattern-based classifier.
 * Used as the primary fast path. Returns score >= 0.90 when a
 * strong pattern is matched; returns score 0.80 with label "general"
 * when no pattern matches (signals CLIP should decide).
 */

export type PrivacyLevel = 'high' | 'medium' | 'low';
export type ClassificationSource = 'heuristic' | 'clip' | 'heuristic_fallback';

export interface ClassificationResult {
  label: string;
  score: number;
  source: ClassificationSource;
  privacyLevel: PrivacyLevel;
}

// ── Pattern banks ─────────────────────────────────────────────────────────────

const FINANCIAL_URL = /\b(sbi|hdfc|icici|axis|kotak|paytm|phonepe|gpay|razorpay|npci|netbanking|creditcard|debitcard|loan|emi|neft|rtgs|upi|mutual.?fund|zerodha|groww|angelone|icicidirect|hdfcsec|kuvera|smallcase|bajajfinserv|indiabulls|rbl|yes.?bank|iob|canara|pnb|bob|boi|union.?bank|allahabad|syndicate|vijaya)\b/i;

const FINANCIAL_DOM = /\b(account.?balance|net.?banking|fund.?transfer|transaction.?history|credit.?card.?number|debit.?card|cvv|card.?expiry|ifsc|swift.?code|bank.?statement|beneficiary|transfer.?amount)\b/i;

const IDENTITY_URL = /\b(aadhaar|uidai|digilocker|incometax|pan.?verification|kyc|passport|voter.?id|driving.?licen|epfo|esic|cowin|ndl|nsdl|cbdt|traces)\b/i;

const IDENTITY_DOM = /\b(aadhaar.?number|aadhar|pan.?card|voter.?id|driving.?licen|passport.?number|date.?of.?birth|dob|father.?name|mother.?name|kyc|biometric|fingerprint|iris.?scan)\b/i;

const HEALTHCARE_URL = /\b(apollo|fortis|manipal|aiims|practo|1mg|pharmeasy|netmeds|medplus|healthkart|lybrate|thyrocare|dr.?lal|healthians|aarogya|cowin|nhm|mohfw|esic|cghs|abha)\b/i;

const HEALTHCARE_DOM = /\b(patient.?id|medical.?record|prescription|diagnosis|blood.?group|health.?insurance|abha.?number|uhid|icd.?code|clinical)\b/i;

const SOCIAL_URL = /\b(facebook|instagram|twitter|x\.com|linkedin|whatsapp|telegram|snapchat|youtube|reddit|quora|pinterest|tumblr|tiktok|discord|slack|teams\.microsoft|zoom\.us|meet\.google)\b/i;

const ECOMMERCE_URL = /\b(amazon|flipkart|myntra|meesho|snapdeal|bigbasket|blinkit|zepto|swiggy|zomato|nykaa|ajio|shopify|cart|checkout|order\.)\b/i;

// ── Main classifier ───────────────────────────────────────────────────────────

/**
 * Classify a page using URL and DOM text patterns.
 *
 * @param url - Full URL of the active page
 * @param domText - Visible text content of the page (first ~4000 chars)
 * @returns ClassificationResult with score >= 0.90 if confident, 0.80 if not
 */
export function heuristicClassify(url: string, domText: string): ClassificationResult {
  const urlL = url.toLowerCase();
  const domL = domText.toLowerCase().slice(0, 4000);

  // ── Financial ───────────────────────────────────────────────────────────────
  if (FINANCIAL_URL.test(urlL) || FINANCIAL_DOM.test(domL)) {
    return {
      label: 'financial',
      score: 0.95,
      source: 'heuristic',
      privacyLevel: 'high',
    };
  }

  // ── Identity / KYC / Government ────────────────────────────────────────────
  if (IDENTITY_URL.test(urlL) || IDENTITY_DOM.test(domL)) {
    return {
      label: 'identity',
      score: 0.95,
      source: 'heuristic',
      privacyLevel: 'high',
    };
  }

  // ── Healthcare ──────────────────────────────────────────────────────────────
  if (HEALTHCARE_URL.test(urlL) || HEALTHCARE_DOM.test(domL)) {
    return {
      label: 'healthcare',
      score: 0.92,
      source: 'heuristic',
      privacyLevel: 'high',
    };
  }

  // ── Social media ────────────────────────────────────────────────────────────
  if (SOCIAL_URL.test(urlL)) {
    return {
      label: 'social',
      score: 0.92,
      source: 'heuristic',
      privacyLevel: 'medium',
    };
  }

  // ── E-commerce ──────────────────────────────────────────────────────────────
  if (ECOMMERCE_URL.test(urlL)) {
    return {
      label: 'ecommerce',
      score: 0.90,
      source: 'heuristic',
      privacyLevel: 'medium',
    };
  }

  // ── Default: no pattern matched → defer to CLIP ─────────────────────────────
  return {
    label: 'general',
    score: 0.80,
    source: 'heuristic_fallback',
    privacyLevel: 'low',
  };
}

/**
 * Map a classification label to a privacy enforcement level.
 */
export function labelToPrivacyLevel(label: string): PrivacyLevel {
  switch (label) {
    case 'financial':
    case 'identity':
    case 'healthcare':
      return 'high';
    case 'social':
    case 'ecommerce':
      return 'medium';
    default:
      return 'low';
  }
}
