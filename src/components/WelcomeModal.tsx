import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useWelcome } from '../state/welcome';
import { useModalDialog } from './useModalDialog';
import { WELCOME_STEPS } from './welcomeSteps';

/*
 * The welcome tour. It only closes from its own buttons -- Skip, or the last
 * page's call to action -- so a stray click on the backdrop or Escape cannot
 * dismiss it before it has been read.
 */
export const WelcomeModal: React.FC = () => {
  const isOpen = useWelcome((state) => state.isOpen);
  return isOpen ? <WelcomeDialog /> : null;
};

const WelcomeDialog: React.FC = () => {
  const close = useWelcome((state) => state.close);
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDialog(true, dialogRef);

  const last = WELCOME_STEPS.length - 1;
  const current = WELCOME_STEPS[step];
  const goTo = (index: number) => setStep(Math.max(0, Math.min(last, index)));

  // Back disappears on the first page; if it had focus, keep focus in the
  // dialog so the arrow keys and Tab still work.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
  }, [step]);

  // Only the page on show plays, from its start each time it comes round.
  // With reduced motion nothing starts by itself: the clip waits on its
  // first frame, with controls to play it.
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    videoRefs.current.forEach((video, index) => {
      if (!video) return;
      if (index !== step) {
        video.pause();
        return;
      }
      video.currentTime = 0;
      // Autoplay can still be refused; the first frame stays on show then.
      if (!reducedMotion) video.play().catch(() => {});
    });
  }, [step, reducedMotion]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goTo(step + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo(step - 1);
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        ref={dialogRef}
        className="about-modal welcome-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-dialog-title"
        aria-describedby="welcome-dialog-body"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {/* Every clip is in the page from the start, so changing page is a
            crossfade rather than a pop-in. The current and next clips load in
            full; the others only their first frame, until their turn comes. */}
        <div className="welcome-media">
          {WELCOME_STEPS.map((s, index) => (
            <video
              key={s.video}
              ref={(element) => {
                videoRefs.current[index] = element;
              }}
              src={s.video}
              aria-label={s.alt}
              aria-hidden={index !== step}
              className={'welcome-image' + (index === step ? ' is-current' : '')}
              muted
              loop
              playsInline
              preload={index === step || index === step + 1 ? 'auto' : 'metadata'}
              controls={reducedMotion && index === step}
              // A clip that fails to load leaves the plain panel, not a broken player.
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          ))}
        </div>

        <div className="welcome-content">
          <div className="welcome-header">
            <span className="about-card-eyebrow welcome-count">
              {step + 1} of {WELCOME_STEPS.length}
            </span>
            {step < last && (
              <button type="button" className="welcome-skip" onClick={close}>
                Skip
              </button>
            )}
          </div>

          <div key={step} className="welcome-text">
            <h2 id="welcome-dialog-title" className="welcome-title">
              {current.title}
            </h2>
            <p id="welcome-dialog-body" className="welcome-body">
              {current.body}
            </p>
          </div>

          <div className="welcome-footer">
            <div className="welcome-dots">
              {WELCOME_STEPS.map((s, index) => (
                <button
                  key={s.video}
                  type="button"
                  className={'welcome-dot' + (index === step ? ' is-current' : '')}
                  aria-label={`Go to step ${index + 1}`}
                  aria-current={index === step ? 'step' : undefined}
                  onClick={() => goTo(index)}
                />
              ))}
            </div>
            <div className="welcome-actions">
              {step > 0 && (
                <button
                  type="button"
                  className="preset-modal-button welcome-back"
                  aria-label="Back"
                  onClick={() => goTo(step - 1)}
                >
                  <ArrowLeft size={14} aria-hidden="true" />
                </button>
              )}
              {step < last ? (
                <button type="button" className="preset-modal-button is-primary welcome-next" onClick={() => goTo(step + 1)}>
                  Next
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              ) : (
                <button type="button" className="preset-modal-button is-primary welcome-next" onClick={close}>
                  Start creating
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
