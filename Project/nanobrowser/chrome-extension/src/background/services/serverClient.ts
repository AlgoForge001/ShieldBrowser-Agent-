/**
 * Server Client — Module 4 (fetch wrapper)
 *
 * Sends the sanitized screenshot + task context to the ShieldBrowse
 * FastAPI server and returns the parsed action list.
 */

import { createLogger } from '../log';

const logger = createLogger('ServerClient');

export const SERVER_BASE_URL = 'http://localhost:8000';

import type { SignedManifest } from '../privacy/egressSigner';

export interface AgentProcessRequest {
  screenshot: string;          // base64 PNG (no prefix)
  dom_context: string;         // redacted DOM text
  task: string;                // user task description
  redaction_report: {
    faces_redacted: number;
    pii_fields_redacted: number;
    total_regions: number;
  };
  signed_manifest?: SignedManifest;
}

export interface ManifestReceiptResponse {
  received: boolean;
  nonce: string;
  timestamp: string;
  region_count: number;
  frame_hash: string;
  message?: string;
}

export interface AgentAction {
  type: 'click' | 'scroll' | 'type' | 'navigate' | 'wait';
  selector?: string;
  description?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  value?: string;
  url?: string;
  ms?: number;
}

export interface AgentProcessResponse {
  actions: AgentAction[];
  reasoning: string;
  model_used: string;
}

/**
 * Checks if the ShieldBrowse server is reachable.
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    const resp = await fetch(`${SERVER_BASE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Sends the sanitized screenshot to the server and returns actions.
 */
export async function processWithServer(
  request: AgentProcessRequest,
  timeoutMs = 60_000,
): Promise<AgentProcessResponse> {
  logger.info('Sending sanitized screenshot to ShieldBrowse server...');

  const response = await fetch(`${SERVER_BASE_URL}/agent/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Server error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as AgentProcessResponse;
  logger.info(`Server returned ${data.actions.length} action(s) via ${data.model_used}`);
  return data;
}

/**
 * Submits the signed egress manifest to the server's audit receipt endpoint.
 */
export async function verifyManifestWithServer(
  manifest: SignedManifest,
  timeoutMs = 10_000,
): Promise<ManifestReceiptResponse> {
  const response = await fetch(`${SERVER_BASE_URL}/agent/verify-manifest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Manifest verification error ${response.status}: ${text}`);
  }

  return (await response.json()) as ManifestReceiptResponse;
}
