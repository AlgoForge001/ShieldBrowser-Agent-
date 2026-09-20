/**
 * Live Action Guardian — Task 3B
 *
 * Three-way safety check right before executing any actionable command:
 *   1. User's Original Intent  — symbol, maxPrice, quantity, destination
 *   2. Live Browser State      — reads the current live DOM for those fields
 *   3. Agent's Next Action     — selector, value the agent wants to type/click
 *
 * If a drift is detected (price spiked, quantity changed, destination changed):
 *   - PAUSE execution
 *   - Emit ACTION_GUARDIAN_ALERT to SidePanel with exact drift details
 *   - Block the action until user confirms or auto-block fires
 *
 * Design goals:
 *   - Zero false positives on normal browsing (only triggers on high-risk action types)
 *   - Async: awaitable from visionActionExecutor before dispatching
 *   - Demo-friendly: clearly visible in SidePanel with diff view
 */

import { createLogger } from '../../log';

const logger = createLogger('LiveActionGuardian');

// ── Types ─────────────────────────────────────────────────────────────────────

/** What the user approved / declared as their intent before the task started. */
export interface GuardedIntent {
  /** Approved symbol to trade / interact with (e.g. 'AAPL', 'HDFC') */
  symbol?: string;
  /** Maximum price the user is willing to accept (number) */
  maxPrice?: number;
  /** Approved quantity */
  quantity?: number;
  /** Approved destination account / address */
  destination?: string;
  /** Free-form description of task intent for logging */
  description?: string;
}

/** One detected drift item */
export interface DriftItem {
  field: string;          // e.g. 'quantity', 'price', 'destination'
  expected: string;       // what the user approved / what was there before
  found: string;          // what the live DOM actually shows now
  severity: 'critical' | 'warning';
}

/** Result returned by the Guardian */
export interface GuardianCheckResult {
  /** true = action is safe to proceed; false = action is blocked/paused */
  safe: boolean;
  /** Detected drift items (empty if safe) */
  drifts: DriftItem[];
  /** Human-readable summary of the check */
  summary: string;
  /** True if the check was skipped (e.g. action type doesn't need guarding) */
  skipped?: boolean;
}

/** The alert payload broadcast to SidePanel */
export interface GuardianAlertPayload {
  type: 'action_guardian_alert';
  action: {
    type: string;
    selector?: string;
    value?: string;
    description?: string;
  };
  drifts: DriftItem[];
  summary: string;
  /** Unique ID so SidePanel can match the response callback */
  checkId: string;
}

// ── Singleton guard intent (set once per task run) ────────────────────────────

let _guardedIntent: GuardedIntent | null = null;

/**
 * Sets the guarded intent for the current task.
 * Call this once at pipeline startup when the user submits their task.
 */
export function setGuardedIntent(intent: GuardedIntent | null): void {
  _guardedIntent = intent;
  if (intent) {
    logger.info('[Guardian] Intent registered:', JSON.stringify(intent));
  } else {
    logger.info('[Guardian] Intent cleared');
  }
}

export function getGuardedIntent(): GuardedIntent | null {
  return _guardedIntent;
}

// ── High-risk action types that trigger a Guardian check ─────────────────────

const HIGH_RISK_TYPES = new Set(['click', 'type']);

// Selectors/keywords that indicate a high-stakes interaction
const HIGH_STAKES_PATTERNS = [
  /submit/i, /confirm/i, /pay/i, /transfer/i, /buy/i, /sell/i,
  /order/i, /proceed/i, /checkout/i, /execute/i, /place/i,
  /send/i, /amount/i, /quantity/i, /price/i, /account/i,
];

function isHighStakesAction(action: { type: string; selector?: string; description?: string; value?: string }): boolean {
  if (!HIGH_RISK_TYPES.has(action.type)) return false;

  const combined = [
    action.selector ?? '',
    action.description ?? '',
    action.value ?? '',
  ].join(' ').toLowerCase();

  return HIGH_STAKES_PATTERNS.some(p => p.test(combined));
}

// ── Live DOM snapshot ─────────────────────────────────────────────────────────

interface DomSnapshot {
  quantity?: string;
  price?: string;
  destination?: string;
  symbol?: string;
}

async function captureLiveDomSnapshot(tabId: number): Promise<DomSnapshot> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Try to read common trading/transfer form fields
        const find = (selectors: string[]): string => {
          for (const sel of selectors) {
            try {
              const el = document.querySelector(sel) as HTMLInputElement | null;
              if (el && el.value) return el.value.trim();
              // Also check visible text content
              const tel = document.querySelector(sel);
              if (tel?.textContent) return tel.textContent.trim();
            } catch { /* skip */ }
          }
          return '';
        };

        return {
          quantity: find([
            '#quantity', 'input[name="quantity"]', 'input[id*="qty"]',
            'input[name*="qty"]', '[data-field="quantity"]', '#qty',
            'input[placeholder*="quantity" i]', 'input[placeholder*="qty" i]',
          ]),
          price: find([
            '#price', 'input[name="price"]', 'input[id*="price"]',
            'input[name*="price"]', '[data-field="price"]', '#limitPrice',
            'input[placeholder*="price" i]', '.price-display',
          ]),
          destination: find([
            '#destination', '#account', '#to-account', 'input[name="destination"]',
            'input[name="account"]', 'input[name*="dest"]', 'input[id*="dest"]',
            'input[placeholder*="account" i]', 'input[placeholder*="destination" i]',
          ]),
          symbol: find([
            '#symbol', 'input[name="symbol"]', '#ticker', 'input[name="ticker"]',
            '.symbol-display', '[data-field="symbol"]',
          ]),
        };
      },
    });
    return (results?.[0]?.result as DomSnapshot) ?? {};
  } catch {
    return {};
  }
}

// ── Core drift detection logic ────────────────────────────────────────────────

function detectDrift(intent: GuardedIntent, snapshot: DomSnapshot): DriftItem[] {
  const drifts: DriftItem[] = [];

  // 1. Quantity drift
  if (intent.quantity !== undefined && snapshot.quantity) {
    const liveQty = parseFloat(snapshot.quantity.replace(/[^0-9.]/g, ''));
    if (!isNaN(liveQty) && Math.abs(liveQty - intent.quantity) > 0.001) {
      drifts.push({
        field: 'quantity',
        expected: String(intent.quantity),
        found: snapshot.quantity,
        severity: Math.abs(liveQty - intent.quantity) / intent.quantity > 0.1 ? 'critical' : 'warning',
      });
    }
  }

  // 2. Price drift (exceeds max price)
  if (intent.maxPrice !== undefined && snapshot.price) {
    const livePrice = parseFloat(snapshot.price.replace(/[^0-9.]/g, ''));
    if (!isNaN(livePrice) && livePrice > intent.maxPrice) {
      drifts.push({
        field: 'price',
        expected: `≤ ${intent.maxPrice}`,
        found: snapshot.price,
        severity: 'critical',
      });
    }
  }

  // 3. Destination / account drift
  if (intent.destination && snapshot.destination) {
    const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
    if (normalize(snapshot.destination) !== normalize(intent.destination)) {
      drifts.push({
        field: 'destination',
        expected: intent.destination,
        found: snapshot.destination,
        severity: 'critical',
      });
    }
  }

  // 4. Symbol drift
  if (intent.symbol && snapshot.symbol) {
    if (snapshot.symbol.toUpperCase() !== intent.symbol.toUpperCase()) {
      drifts.push({
        field: 'symbol',
        expected: intent.symbol,
        found: snapshot.symbol,
        severity: 'critical',
      });
    }
  }

  return drifts;
}

// ── Pending confirmation map ──────────────────────────────────────────────────

type ConfirmResolve = (confirmed: boolean) => void;
const _pendingConfirmations = new Map<string, ConfirmResolve>();

/**
 * Called by the background message handler when the user responds to a
 * Guardian alert (approve or block).
 */
export function resolveGuardianConfirmation(checkId: string, approved: boolean): void {
  const resolve = _pendingConfirmations.get(checkId);
  if (resolve) {
    _pendingConfirmations.delete(checkId);
    resolve(approved);
    logger.info(`[Guardian] Check ${checkId} resolved: ${approved ? 'APPROVED' : 'BLOCKED'}`);
  }
}

// ── Main Guardian check entry point ──────────────────────────────────────────

/**
 * Performs the pre-execution Guardian check.
 *
 * @param action    The action the agent wants to execute
 * @param portRef   The chrome.runtime.Port ref to broadcast the alert
 * @param timeoutMs How long to wait for user confirmation before auto-blocking
 */
export async function guardianCheck(
  action: { type: string; selector?: string; value?: string; description?: string },
  broadcastAlert: (payload: GuardianAlertPayload) => void,
  timeoutMs = 30_000,
): Promise<GuardianCheckResult> {

  // Skip check if no guarded intent is set, or action isn't high-stakes
  if (!_guardedIntent || !isHighStakesAction(action)) {
    return {
      safe: true,
      drifts: [],
      summary: 'Guardian check skipped — action is low-risk',
      skipped: true,
    };
  }

  logger.info(`[Guardian] Checking action: ${action.type} ${action.selector ?? ''}`);

  // Get active tab ID
  let tabId: number | undefined;
  try {
    const allTabs = await chrome.tabs.query({ active: true });
    const activeTab = allTabs.find(t => t.url?.startsWith('http'));
    tabId = activeTab?.id;
  } catch { /* ok */ }

  if (!tabId) {
    logger.warning('[Guardian] No active tab — skipping live DOM snapshot');
    return {
      safe: true,
      drifts: [],
      summary: 'Guardian check skipped — no active tab',
      skipped: true,
    };
  }

  // Capture live DOM snapshot
  const snapshot = await captureLiveDomSnapshot(tabId);
  logger.info('[Guardian] Live DOM snapshot:', JSON.stringify(snapshot));

  // Detect drift
  const drifts = detectDrift(_guardedIntent, snapshot);

  if (drifts.length === 0) {
    logger.info('[Guardian] No drift detected — action is safe');
    return {
      safe: true,
      drifts: [],
      summary: 'Live state matches intent — action safe to proceed',
    };
  }

  // Drift detected — emit alert and wait for user confirmation
  const criticalDrifts = drifts.filter(d => d.severity === 'critical');
  const summary = `${drifts.length} drift(s) detected: ${drifts.map(d => `${d.field} changed (${d.expected} → ${d.found})`).join(', ')}`;

  logger.warning(`[Guardian] DRIFT DETECTED: ${summary}`);

  const checkId = `guard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const alertPayload: GuardianAlertPayload = {
    type: 'action_guardian_alert',
    action: {
      type: action.type,
      selector: action.selector,
      value: action.value,
      description: action.description,
    },
    drifts,
    summary,
    checkId,
  };

  // Broadcast to SidePanel
  broadcastAlert(alertPayload);

  // Auto-block critical drifts immediately (no user confirmation needed)
  if (criticalDrifts.length > 0) {
    logger.warning('[Guardian] CRITICAL drift — action auto-blocked');
    return {
      safe: false,
      drifts,
      summary: `BLOCKED: ${summary}`,
    };
  }

  // For warnings: wait for user confirmation with timeout
  const confirmed = await new Promise<boolean>((resolve) => {
    _pendingConfirmations.set(checkId, resolve);
    // Auto-block after timeout if no user response
    setTimeout(() => {
      if (_pendingConfirmations.has(checkId)) {
        _pendingConfirmations.delete(checkId);
        logger.warning('[Guardian] Confirmation timeout — auto-blocking action');
        resolve(false);
      }
    }, timeoutMs);
  });

  return {
    safe: confirmed,
    drifts,
    summary: confirmed ? `User approved action despite drift` : `BLOCKED by user: ${summary}`,
  };
}
