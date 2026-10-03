import React, { useEffect, useRef, useState } from 'react';
import { CircleQuestionMark, ExternalLink, Sparkles, X } from 'lucide-react';
import { SHORTCUT_COLUMNS } from './shortcutList';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const AboutModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    // Whatever had focus before (usually the Shortcuts & info button) gets it back on close.
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
      {/* The toolbar's own pill and button, so it stands as tall as the menus. */}
      <div className="glass toolbar-pill help-pill">
        <button
          type="button"
          className={'toolbar-button' + (isOpen ? ' is-active' : '')}
          aria-haspopup="dialog"
          onClick={() => setIsOpen(true)}
        >
          <CircleQuestionMark size={14} aria-hidden="true" />
          <span>Shortcuts &amp; info</span>
        </button>
      </div>

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

              <section className="about-shortcuts" aria-labelledby="about-shortcuts-title">
                <h3 id="about-shortcuts-title" className="about-section-title">
                  Keyboard shortcuts
                </h3>
                <div className="shortcut-columns">
                  {SHORTCUT_COLUMNS.map((column, columnIndex) => (
                    <div key={columnIndex} className="shortcut-column">
                      {column.map((section) => (
                        <div key={section.title} className="shortcut-section">
                          <h4 className="shortcut-section-title">{section.title}</h4>
                          <dl className="shortcut-list">
                            {section.items.map((item) => (
                              <div key={item.label} className="shortcut-row">
                                <dt className="shortcut-label">
                                  {item.label}
                                  {item.note && <span className="shortcut-note">{item.note}</span>}
                                </dt>
                                <dd className="shortcut-keys">
                                  {item.keys.map((combo, index) => (
                                    <React.Fragment key={combo.join('+')}>
                                      {index > 0 && <span className="shortcut-or">or</span>}
                                      <span className="shortcut-combo">
                                        {combo.map((key) => (
                                          <kbd key={key}>{key}</kbd>
                                        ))}
                                      </span>
                                    </React.Fragment>
                                  ))}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </section>

              <div className="about-footer">
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
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
