import React from 'react';
import { FiShield, FiX, FiCheckCircle, FiLock, FiAlertTriangle, FiActivity, FiSearch } from 'react-icons/fi';

interface PrivacyShieldModalProps {
  isOpen: boolean;
  onClose: () => void;
  redactedCount: number;
  detectedTypes: string[];
  // Task 1: Live pipeline state
  pipelineActive?: boolean;
  sessionRedactedCount?: number;
  lastScanTime?: number | null;
}

export const PrivacyShieldModal: React.FC<PrivacyShieldModalProps> = ({
  isOpen,
  onClose,
  redactedCount,
  detectedTypes,
  pipelineActive = false,
  sessionRedactedCount = 0,
  lastScanTime = null,
}) => {
  if (!isOpen) return null;

  const formatScanTime = (ts: number | null): string => {
    if (!ts) return 'Not yet scanned';
    const diff = Math.round((Date.now() - ts) / 1000);
    if (diff < 5) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    return `${Math.round(diff / 60)}m ago`;
  };

  return (
    <div className="privacy-modal-overlay">
      <div className="privacy-modal-container">
        <div className="privacy-modal-header">
          <div className="privacy-modal-title">
            <FiShield className={`privacy-shield-icon ${pipelineActive ? 'scanning-pulse' : 'active'}`} />
            <div>
              <h3>Privacy Shield Engine</h3>
              <p className="privacy-subtitle">On-Device Zero-Trust Pipeline</p>
            </div>
          </div>
          <button className="privacy-close-btn" onClick={onClose} aria-label="Close">
            <FiX />
          </button>
        </div>

        <div className="privacy-modal-body">
          {/* Status Badge */}
          <div className="privacy-status-card">
            <div className={`status-indicator-dot ${pipelineActive ? 'scanning' : 'online'}`}></div>
            <div className="status-info">
              <span className="status-label">
                {pipelineActive && <FiSearch className="mr-1 inline-block size-4" aria-hidden="true" />}
                {pipelineActive ? 'Scanning Page...' : 'Privacy Shield Active'}
              </span>
              <span className="status-sub">
                {pipelineActive
                  ? 'Detecting PII regions in live DOM & screenshot'
                  : 'All DOM text and URLs are scrubbed before LLM ingestion'}
              </span>
            </div>
            <span className="shield-tag">Zero-Leakage</span>
          </div>

          {/* Live Scan Info */}
          {lastScanTime && (
            <div className="privacy-scan-info">
              <FiActivity size={12} />
              <span>Last scan: {formatScanTime(lastScanTime)}</span>
            </div>
          )}

          {/* Metrics Grid */}
          <div className="privacy-metrics-grid">
            <div className="metric-box">
              <span className="metric-value">{sessionRedactedCount || redactedCount}</span>
              <span className="metric-name">Session Total</span>
            </div>
            <div className="metric-box">
              <span className="metric-value">{detectedTypes.length}</span>
              <span className="metric-name">PII Patterns</span>
            </div>
            <div className="metric-box">
              <span className="metric-value">100%</span>
              <span className="metric-name">Local Only</span>
            </div>
          </div>

          {/* Protected Types Section */}
          <div className="privacy-section">
            <h4>Active Guard Filters</h4>
            <div className="filter-chips-list">
              {[
                'Aadhaar ID',
                'PAN Card',
                'Phone Number',
                'Email Address',
                'Passport',
                'Credit / Debit Card',
                'Bank Account',
                'UPI ID',
                'IFSC Code',
                'IPv4 Address',
              ].map(type => {
                const isDetected = detectedTypes.some(d =>
                  type.toLowerCase().includes(d.toLowerCase()) || d.toLowerCase().includes(type.toLowerCase())
                );
                return (
                  <div key={type} className={`filter-chip ${isDetected ? 'detected' : ''}`}>
                    {isDetected ? <FiAlertTriangle className="chip-icon warn" /> : <FiCheckCircle className="chip-icon" />}
                    <span>{type}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Privacy Architecture Notice */}
          <div className="privacy-security-box">
            <FiLock className="sec-icon" />
            <div className="sec-text">
              <strong>Privacy Shadow Architecture:</strong> Sensitive fields are replaced with semantic tokens (e.g. <code>&lt;IDENTITY_ID&gt;</code>, <code>&lt;CREDENTIAL&gt;</code>) before reaching the AI. Real values stay on your device. The AI gets just enough context to do its job — nothing more.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
