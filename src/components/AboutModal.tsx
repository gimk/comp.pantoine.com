import React, { useEffect, useState } from 'react';
import { ExternalLink, Sparkles, X } from 'lucide-react';

export const AboutModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        className="help-button glass"
        onClick={() => setIsOpen(true)}
        aria-label="About and credits"
        title="About & Credits"
      >
        ?
      </button>

      {isOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setIsOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="about-dialog-title"
        >
          <div className="about-modal" onClick={(e) => e.stopPropagation()}>
            <div className="about-modal-header">
              <div className="about-brand-row">
                <span className="brand about-brand-pill">COMP</span>
                <span className="about-badge">Studio</span>
              </div>
              <button
                type="button"
                className="about-modal-close"
                onClick={() => setIsOpen(false)}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            <div className="about-modal-body">
              <div className="about-intro">
                <h2 id="about-dialog-title" className="about-title">
                  Node-based visual compositor
                </h2>
                <p className="about-desc">
                  An open canvas for live shader effects, analog CRT &amp; tape artifacts,
                  color grading, and signal-driven procedural animation.
                </p>
              </div>

              <div className="about-card about-credits-card">
                <div className="about-card-icon">
                  <Sparkles size={15} />
                </div>
                <div className="about-card-content">
                  <div className="about-card-eyebrow">Author &amp; Design</div>
                  <div className="about-card-lead">
                    Made with dedication by{' '}
                    <a
                      href="https://www.pantoine.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="about-link"
                    >
                      Antoine Pouligny
                      <ExternalLink size={12} className="about-ext-icon" />
                    </a>
                  </div>
                </div>
              </div>

              <div className="about-card about-meta-card">
                <div className="about-meta-row">
                  <span className="about-meta-label">Graph Runtime</span>
                  <a
                    href="https://reactflow.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="about-meta-link"
                  >
                    React Flow
                    <ExternalLink size={11} className="about-ext-icon" />
                  </a>
                </div>
                <div className="about-meta-divider" />
                <div className="about-meta-row">
                  <span className="about-meta-label">Shader Pipeline</span>
                  <span className="about-meta-value">WebGL 2.0 Engine</span>
                </div>
              </div>

              <div className="about-shortcuts-hint">
                <span><kbd>Shift</kbd> + <kbd>A</kbd> Add node</span>
                <span className="about-hint-sep">•</span>
                <span><kbd>Space</kbd> Play / pause</span>
                <span className="about-hint-sep">•</span>
                <span><kbd>R</kbd> Reset</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
