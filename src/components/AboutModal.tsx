import React, { useRef, useState } from 'react';
import { ArrowRight, CircleQuestionMark, ExternalLink, GraduationCap, Sparkles, X } from 'lucide-react';
import { useWelcome } from '../state/welcome';
import { SHORTCUT_COLUMNS } from './shortcutList';
import { useModalDialog } from './useModalDialog';
import { ThemeToggle } from './ThemeToggle';
// Named, so the bundle carries the version and not the rest of the manifest.
import { version } from '../../package.json';

export const AboutModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openWelcome = useWelcome((state) => state.open);
  useModalDialog(isOpen, dialogRef, () => setIsOpen(false));

  // This dialog closes first, so focus returns to the help button and the
  // tour hands it back there when it closes in turn.
  const takeTour = () => {
    setIsOpen(false);
    openWelcome();
  };

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
        <span className="toolbar-sep" />
        <ThemeToggle />
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
                <span className="about-version">v{version}</span>
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

              <button type="button" className="about-card about-tour-card" onClick={takeTour}>
                <span className="about-card-icon">
                  <GraduationCap size={15} aria-hidden="true" />
                </span>
                <span className="about-card-content">
                  <span className="about-card-eyebrow">New here?</span>
                  <span className="about-card-lead">Take the quick tour</span>
                </span>
                <ArrowRight size={14} className="about-tour-arrow" aria-hidden="true" />
              </button>

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
