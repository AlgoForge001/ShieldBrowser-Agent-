import React from 'react';
import { FiShield, FiX, FiCheckCircle, FiLock, FiAlertTriangle } from 'react-icons/fi';

interface PrivacyShieldModalProps {
  isOpen: boolean;
  onClose: () => void;
  redactedCount: number;
  detectedTypes: string[];
}

export const PrivacyShieldModal: React.FC<PrivacyShieldModalProps> = ({
  isOpen,
  onClose,
  redactedCount,
  detectedTypes,
}) => {
  if (!isOpen) return null;

  return (
    <div className="privacy-modal-overlay">
      <div className="privacy-modal-container">
        <div className="privacy-modal-header">
          <div className="privacy-modal-title">
            <FiShield className="privacy-shield-icon active" />
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
            <div className="status-indicator-dot online"></div>
            <div className="status-info">
              <span className="status-label">Privacy Shield Active</span>
              <span className="status-sub">All DOM text and URLs are scrubbed before LLM ingestion</span>
            </div>
            <span className="shield-tag">Zero-Leakage</span>
          </div>

          {/* Metrics Grid */}
          <div className="privacy-metrics-grid">
            <div className="metric-box">
              <span className="metric-value">{redactedCount}</span>
              <span className="metric-name">PII Items Masked</span>
            </div>
            <div className="metric-box">
              <span className="metric-value">{detectedTypes.length}</span>
              <span className="metric-name">PII Patterns Caught</span>
            </div>
            <div className="metric-box">
              <span className="metric-value">100%</span>
              <span className="metric-name">Local Execution</span>
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
              <strong>Cryptographic Clean Slate:</strong> Raw personal identities are permanently tokenized into typed markers (e.g. <code>[REDACTED-AADHAAR]</code>) in memory. No plaintext PII ever touches LLM context or logs.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
