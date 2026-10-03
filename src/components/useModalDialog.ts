import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The keyboard side of a modal dialog: focus moves in on open and back to
 * whatever had it on close, Tab cycles inside, and Escape is kept off the
 * canvas. `onEscape` closes the dialog; leave it out for one that must be
 * closed from its own buttons.
 */
export const useModalDialog = (
  isOpen: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onEscape?: () => void,
): void => {
  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    // Whatever had focus before (usually the button that opened it) gets it back on close.
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
        onEscape?.();
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
    // onEscape is left out on purpose: a new closure each render must not
    // re-run this and bounce focus around.
  }, [isOpen, dialogRef]);
};
