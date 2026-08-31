import { detectPii, PiiType } from './chrome-extension/src/background/privacy/piiDetector';
import { redactText, redactUrl, redactTitle } from './chrome-extension/src/background/privacy/piiRedactor';
import { privacyAuditLog, AuditSource } from './chrome-extension/src/background/privacy/auditLog';

function runTests() {
  console.log('--- RUNNING PRIVACY SHIELD TEST SUITE ---\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, extra?: any) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`, extra || '');
      failed++;
    }
  }

  // 1. Aadhaar Detection & Redaction
  const sampleAadhaar = 'User aadhaar number is 5482 1234 5678 and registered.';
  const resAadhaar = redactText(sampleAadhaar);
  assert(
    resAadhaar.redacted.includes('[REDACTED-AADHAAR]'),
    'Aadhaar detection and token replacement',
    resAadhaar.redacted
  );
  assert(!resAadhaar.redacted.includes('5482 1234 5678'), 'Aadhaar raw number removed');

  // 2. PAN Card
  const samplePan = 'PAN details: ABCDE1234F submitted for KYC';
  const resPan = redactText(samplePan);
  assert(resPan.redacted.includes('[REDACTED-PAN]'), 'PAN card detection and token replacement');
  assert(!resPan.redacted.includes('ABCDE1234F'), 'PAN raw card removed');

  // 3. Indian Phone Number & Email
  const sampleContact = 'Contact customer at +91 9876543210 or user.name@domain.com immediately.';
  const resContact = redactText(sampleContact);
  assert(resContact.redacted.includes('[REDACTED-PHONE]'), 'Phone number detected & redacted');
  assert(resContact.redacted.includes('[REDACTED-EMAIL]'), 'Email detected & redacted');
  assert(!resContact.redacted.includes('9876543210'), 'Phone raw number stripped');
  assert(!resContact.redacted.includes('user.name@domain.com'), 'Email address stripped');

  // 4. Credit Card
  const sampleCC = 'Card on file: 4111 2222 3333 4444 exp 12/28';
  const resCC = redactText(sampleCC);
  assert(resCC.redacted.includes('[REDACTED-CREDIT_CARD]'), 'Credit card detected & redacted');

  // 5. URL Query Parameter Redaction
  const sampleUrl = 'https://portal.gov.in/kyc?pan=ABCDE1234F&email=john@test.com&phone=9876543210';
  const resUrl = redactUrl(sampleUrl);
  assert(
    !resUrl.includes('ABCDE1234F') &&
    !resUrl.includes('john@test.com') &&
    !resUrl.includes('9876543210'),
    'URL query parameters redacted properly',
    resUrl
  );

  // 6. Audit Log Recording & Subscription
  let logTriggered = false;
  const unsubscribe = privacyAuditLog.subscribe((entry) => {
    logTriggered = true;
    assert(entry.piiTypes.includes(PiiType.PAN), 'Audit log contains PAN type');
  });

  privacyAuditLog.record({
    pageUrl: 'https://example.com/checkout',
    pageTitle: 'User Profile - ABCDE1234F',
    piiTypes: [PiiType.PAN, PiiType.EMAIL],
    redactedCount: 2,
    source: AuditSource.DOM_TEXT,
  });

  assert(logTriggered, 'Audit log event published to subscribers');
  const summary = privacyAuditLog.getSummary();
  assert(summary.totalEntries >= 1, 'Audit log summary records entries');
  assert(summary.totalRedacted >= 2, 'Audit log summary total redacted count is accurate');

  unsubscribe();

  console.log(`\n--- TEST RESULTS: ${passed} PASSED, ${failed} FAILED ---`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
