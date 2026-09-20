import React, { useState, useEffect, useCallback } from 'react';
import {
  FiLock,
  FiX,
  FiPlus,
  FiTrash2,
  FiShield,
  FiEye,
  FiEyeOff,
  FiCheck,
  FiAlertTriangle,
} from 'react-icons/fi';

// ─── Types (mirrored from credentialStore — no direct import to keep UI bundle clean) ─
type TokenType =
  | 'CREDENTIAL'
  | 'IDENTITY_ID'
  | 'TAX_ID'
  | 'OTP'
  | 'CARD_NUMBER'
  | 'CARD_SECURITY'
  | 'PHONE'
  | 'EMAIL'
  | 'BANK_ACCOUNT'
  | 'UPI_ID'
  | 'IFSC';

interface CredentialEntry {
  id: string;
  label: string;
  tokenType: TokenType;
  encryptedValue: string;
  hint: string;
  createdAt: number;
}

interface CredentialVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  port?: chrome.runtime.Port | null;
  /** Tokens the last vision scan resolved — used in Trust Proof tab */
  lastScanTokens?: string[];
  /** Total PII regions from last scan */
  lastScanRegions?: number;
  isDarkMode?: boolean;
}

// ─── Token type metadata ───────────────────────────────────────────────────────
const TOKEN_META: Record<TokenType, { label: string; placeholder: string; icon: string }> = {
  CREDENTIAL:    { label: 'Password / PIN',     placeholder: 'Enter your password',       icon: '🔑' },
  IDENTITY_ID:   { label: 'Aadhaar Number',     placeholder: '1234 5678 9012',             icon: '🪪' },
  TAX_ID:        { label: 'PAN Card',           placeholder: 'ABCDE1234F',                icon: '📋' },
  OTP:           { label: 'OTP / Passcode',     placeholder: '6-digit OTP',               icon: '🔢' },
  CARD_NUMBER:   { label: 'Card Number',        placeholder: '4111 1111 1111 1111',        icon: '💳' },
  CARD_SECURITY: { label: 'CVV / Card Security',placeholder: '3-digit CVV',               icon: '🛡️' },
  PHONE:         { label: 'Phone Number',       placeholder: '+91 98765 43210',            icon: '📱' },
  EMAIL:         { label: 'Email Address',      placeholder: 'you@example.com',            icon: '📧' },
  BANK_ACCOUNT:  { label: 'Bank Account No.',   placeholder: '12-digit account number',   icon: '🏦' },
  UPI_ID:        { label: 'UPI ID',             placeholder: 'name@upi',                  icon: '💸' },
  IFSC:          { label: 'IFSC Code',          placeholder: 'HDFC0001234',               icon: '🏛️' },
};

// ─── Component ────────────────────────────────────────────────────────────────
export const CredentialVaultModal: React.FC<CredentialVaultModalProps> = ({
  isOpen,
  onClose,
  port,
  lastScanTokens = [],
  lastScanRegions = 0,
  isDarkMode = false,
}) => {
  const [activeTab, setActiveTab] = useState<'vault' | 'trust'>('vault');
  const [entries, setEntries] = useState<CredentialEntry[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formLabel, setFormLabel] = useState('');
  const [formTokenType, setFormTokenType] = useState<TokenType>('CREDENTIAL');
  const [formValue, setFormValue] = useState('');
  const [showFormValue, setShowFormValue] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ─── Load credentials via chrome.runtime.sendMessage ───────────────────────
  const loadCredentials = useCallback(() => {
    try {
      chrome.runtime.sendMessage({ type: 'vault_get_all' }, (res: any) => {
        if (chrome.runtime.lastError) {
          console.warn('[Vault] runtime.lastError on load:', chrome.runtime.lastError.message);
          return;
        }
        if (res && Array.isArray(res.entries)) {
          setEntries(res.entries);
        }
      });
    } catch (e) {
      console.error('[Vault] load error:', e);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadCredentials();
      setShowAddForm(false);
      setError(null);
    }
  }, [isOpen, loadCredentials]);

  // ─── Save credential ───────────────────────────────────────────────────────
  const handleSave = () => {
    if (!formLabel.trim() || !formValue.trim()) {
      setError('Label and value are required.');
      return;
    }
    setIsSaving(true);
    setError(null);

    try {
      chrome.runtime.sendMessage(
        {
          type: 'vault_save',
          label: formLabel.trim(),
          tokenType: formTokenType,
          value: formValue.trim(),
        },
        (res: any) => {
          setIsSaving(false);
          if (chrome.runtime.lastError) {
            setError(chrome.runtime.lastError.message || 'Failed to communicate with background service');
            return;
          }
          if (res?.success && res.entry) {
            setEntries(prev => {
              const idx = prev.findIndex(e => e.id === res.entry.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = res.entry;
                return next;
              }
              return [...prev, res.entry];
            });
            setSaveSuccess(true);
            setFormLabel('');
            setFormValue('');
            setShowAddForm(false);
            setTimeout(() => setSaveSuccess(false), 2500);
          } else {
            setError(res?.error || 'Failed to save credential');
          }
        },
      );
    } catch (e: any) {
      setIsSaving(false);
      setError(e instanceof Error ? e.message : 'Failed to save credential');
    }
  };

  // ─── Delete credential ─────────────────────────────────────────────────────
  const handleDelete = (id: string) => {
    setDeletingId(id);
    try {
      chrome.runtime.sendMessage({ type: 'vault_delete', id }, (res: any) => {
        setDeletingId(null);
        if (chrome.runtime.lastError) {
          console.warn('[Vault] delete error:', chrome.runtime.lastError.message);
          return;
        }
        if (res?.success) {
          setEntries(prev => prev.filter(e => e.id !== id));
        } else {
          setError(res?.error || 'Failed to delete credential');
        }
      });
    } catch (e) {
      setDeletingId(null);
      console.error('[Vault] delete error:', e);
    }
  };

  if (!isOpen) return null;

  const dm = isDarkMode;

  return (
    <div className="vault-modal-overlay" onClick={onClose}>
      <div
        className={`vault-modal-container ${dm ? 'vault-dark' : ''}`}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="vault-modal-header">
          <div className="vault-modal-title">
            <FiLock className="vault-title-icon" />
            <div>
              <h3>Personal Credential Vault</h3>
              <p className="vault-subtitle">Device-local · AES-256 Encrypted · Never sent to AI</p>
            </div>
          </div>
          <button className="vault-close-btn" onClick={onClose} aria-label="Close">
            <FiX />
          </button>
        </div>

        {/* Tabs */}
        <div className="vault-tabs">
          <button
            className={`vault-tab ${activeTab === 'vault' ? 'active' : ''}`}
            onClick={() => setActiveTab('vault')}>
            🔑 My Vault
          </button>
          <button
            className={`vault-tab ${activeTab === 'trust' ? 'active' : ''}`}
            onClick={() => setActiveTab('trust')}>
            🛡️ Trust Proof
          </button>
        </div>

        {/* ── Tab: My Vault ─────────────────────────────────────────────────── */}
        {activeTab === 'vault' && (
          <div className="vault-body">
            {/* Success banner */}
            {saveSuccess && (
              <div className="vault-success-banner">
                <FiCheck /> Credential saved and encrypted on your device.
              </div>
            )}

            {error && (
              <div className="vault-error-banner">
                <FiAlertTriangle /> {error}
              </div>
            )}

            {/* Entry list */}
            {entries.length === 0 && !showAddForm && (
              <div className="vault-empty">
                <FiLock size={32} opacity={0.3} />
                <p>No credentials stored yet.</p>
                <p className="vault-empty-sub">
                  Add your Aadhaar, PAN, password, or bank details here.
                  They will be used automatically when the agent fills forms.
                </p>
              </div>
            )}

            {entries.length > 0 && (
              <div className="vault-entries">
                {entries.map(entry => (
                  <div key={entry.id} className="vault-entry">
                    <span className="vault-entry-icon">{TOKEN_META[entry.tokenType]?.icon ?? '🔒'}</span>
                    <div className="vault-entry-info">
                      <span className="vault-entry-label">{entry.label}</span>
                      <span className="vault-entry-meta">
                        {TOKEN_META[entry.tokenType]?.label} · {entry.hint}
                      </span>
                    </div>
                    <span className="vault-entry-token">
                      {'<'}{entry.tokenType}{'>'}
                    </span>
                    <button
                      className="vault-delete-btn"
                      onClick={() => handleDelete(entry.id)}
                      disabled={deletingId === entry.id}
                      aria-label="Delete credential">
                      {deletingId === entry.id ? '…' : <FiTrash2 size={14} />}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add form */}
            {showAddForm ? (
              <div className="vault-add-form">
                <div className="vault-form-row">
                  <label>Label</label>
                  <input
                    type="text"
                    placeholder="e.g. HDFC Bank Password"
                    value={formLabel}
                    onChange={e => setFormLabel(e.target.value)}
                    className="vault-input"
                  />
                </div>
                <div className="vault-form-row">
                  <label>Type</label>
                  <select
                    value={formTokenType}
                    onChange={e => setFormTokenType(e.target.value as TokenType)}
                    className="vault-input">
                    {(Object.keys(TOKEN_META) as TokenType[]).map(t => (
                      <option key={t} value={t}>
                        {TOKEN_META[t].icon} {TOKEN_META[t].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="vault-form-row">
                  <label>Value</label>
                  <div className="vault-value-input-wrap">
                    <input
                      type={showFormValue ? 'text' : 'password'}
                      placeholder={TOKEN_META[formTokenType]?.placeholder}
                      value={formValue}
                      onChange={e => setFormValue(e.target.value)}
                      className="vault-input vault-value-input"
                    />
                    <button
                      className="vault-eye-btn"
                      onClick={() => setShowFormValue(v => !v)}
                      type="button"
                      aria-label="Toggle visibility">
                      {showFormValue ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                    </button>
                  </div>
                </div>
                <div className="vault-form-info">
                  🔒 This value will be encrypted with AES-256 and stored only on your device.
                  The AI agent will only see <strong>{'<'}{formTokenType}{'>'}</strong>, never the real value.
                </div>
                <div className="vault-form-actions">
                  <button
                    className="vault-btn-secondary"
                    onClick={() => { setShowAddForm(false); setError(null); }}>
                    Cancel
                  </button>
                  <button
                    className="vault-btn-primary"
                    onClick={handleSave}
                    disabled={isSaving}>
                    {isSaving ? 'Saving…' : '🔒 Save Encrypted'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="vault-add-btn"
                onClick={() => { setShowAddForm(true); setError(null); }}>
                <FiPlus size={14} /> Add Credential
              </button>
            )}

            {/* Footer trust note */}
            <div className="vault-footer-note">
              <FiShield size={11} />
              All values encrypted with AES-GCM 256-bit · Stored in <code>chrome.storage.local</code> · Never synced · Never sent to AI
            </div>
          </div>
        )}

        {/* ── Tab: Trust Proof ──────────────────────────────────────────────── */}
        {activeTab === 'trust' && (
          <div className="vault-body">
            <div className="trust-hero">
              <FiShield size={28} className="trust-hero-icon" />
              <h4>What the AI Actually Receives</h4>
              <p>The Vision Pipeline replaces every real credential with a semantic token before sending to the AI server. The AI never sees your real data.</p>
            </div>

            {lastScanTokens.length > 0 ? (
              <>
                <div className="trust-scan-summary">
                  <span className="trust-badge">{lastScanRegions} regions protected</span>
                  <span className="trust-badge trust-badge-green">{lastScanTokens.length} token type(s) used</span>
                </div>
                <div className="trust-tokens-list">
                  {lastScanTokens.map(token => (
                    <div key={token} className="trust-token-row">
                      <code className="trust-token">{token}</code>
                      <span className="trust-arrow">←</span>
                      <span className="trust-masked">real value encrypted on device</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="trust-no-scan">
                <p>No scan data yet. Run an agent task on a page with sensitive fields to see live proof.</p>
              </div>
            )}

            <div className="trust-proof-grid">
              <div className="trust-proof-card">
                <span className="trust-proof-icon">🌐</span>
                <strong>Server receives</strong>
                <code>{'<CREDENTIAL>'}</code>
                <span>Semantic token only</span>
              </div>
              <div className="trust-proof-card trust-proof-card-red">
                <span className="trust-proof-icon">🚫</span>
                <strong>Server NEVER sees</strong>
                <code>MyBankPass@123</code>
                <span>Real value blocked client-side</span>
              </div>
              <div className="trust-proof-card trust-proof-card-green">
                <span className="trust-proof-icon">✅</span>
                <strong>DOM filled with</strong>
                <code>MyBankPass@123</code>
                <span>Token resolved locally</span>
              </div>
            </div>

            <div className="trust-storage-proof">
              <strong>Storage audit:</strong>
              <p>Open Chrome → <code>chrome://extensions</code> → Service Worker → DevTools → Application → Storage → Local Storage → <code>shieldbrowse_vault_v1</code></p>
              <p>You will see only <em>encrypted ciphertext</em> — the plaintext values are never stored.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
