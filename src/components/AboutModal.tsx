import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Sparkles, X } from 'lucide-react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const AboutModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    // Whatever had focus before (usually the ? button) gets it back on close.
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.focus();

    /*
     * Capture phase on the window, so this runs -- and can stop the event --
     * before the canvas's own window listener. The canvas shortcuts also
     * stand down while an aria-modal dialog is in the document, which is
     * what keeps Space, Ctrl+A and friends off the graph behind this one.
     */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      // Keep Tab cycling inside the dialog rather than wandering off onto
      // the canvas controls behind the backdrop.
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      returnTo?.focus();
    };
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
        >
          <div
            ref={dialogRef}
            className="about-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-dialog-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
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
                <span><kbd>Shift</kbd> + <kbd>A</kbd> / <kbd>I</kbd> · <kbd>⌘</kbd><kbd>/</kbd> Add node</span>
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
