import React, { useEffect, useState } from 'react';
import { useStore, type ReactFlowState } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { useGraph } from '../state/store';
import { isGroup } from '../state/groups';
import { useActivity } from '../state/activity';
import { contextKey, hintsFor, type HeldKey, type HintContext } from './shortcutHints';

const connecting = (state: ReactFlowState): boolean => state.connection.inProgress;

/**
 * The shortcuts that apply right now, bottom centre: what to press with the
 * selection in hand, or mid-gesture, the keys that change the gesture --
 * lit while they are held, so it is plain which one is doing what.
 *
 * Quiet on purpose: small, faint, and it takes no pointer events, so it
 * never stands between the pointer and the graph.
 */
export const HintBar: React.FC = () => {
  const scrubbing = useActivity((state) => state.scrubbing);
  const wire = useStore(connecting);
  const dragging = useGraph((state) => state.nodes.some((node) => node.dragging));
  const selection = useGraph(
    useShallow((state) => {
      let count = 0;
      let group = false;
      for (const node of state.nodes) {
        if (!node.selected) continue;
        count += 1;
        if (isGroup(node)) group = true;
      }
      return { count, group };
    }),
  );

  const context: HintContext = scrubbing
    ? { kind: 'scrub' }
    : wire
      ? { kind: 'wire' }
      : dragging
        ? { kind: 'drag' }
        : { kind: 'selection', ...selection };

  const held = useHeldKeys(context.kind === 'scrub' || context.kind === 'drag');
  const hints = hintsFor(context);

  return (
    <div className="hint-bar" aria-hidden="true">
      <div key={contextKey(context)} className="hint-bar-row">
        {hints.map((hint) => (
          <span key={hint.label} className={'hint' + (hint.held && held[hint.held] ? ' is-held' : '')}>
            <span className="hint-keys">
              {hint.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </span>
            {hint.label}
          </span>
        ))}
      </div>
    </div>
  );
};

/** Shift, Ctrl and Alt as they are right now, followed only while asked. */
const useHeldKeys = (active: boolean): Record<HeldKey, boolean> => {
  const [held, setHeld] = useState<Record<HeldKey, boolean>>({ shift: false, ctrl: false, alt: false });
  useEffect(() => {
    if (!active) {
      setHeld({ shift: false, ctrl: false, alt: false });
      return;
    }
    const read = (event: KeyboardEvent | PointerEvent) =>
      setHeld((prev) =>
        prev.shift === event.shiftKey && prev.ctrl === event.ctrlKey && prev.alt === event.altKey
          ? prev
          : { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey },
      );
    // Capture, so a handler that stops a key on its way down cannot hide it.
    window.addEventListener('keydown', read, true);
    window.addEventListener('keyup', read, true);
    window.addEventListener('pointermove', read, true);
    return () => {
      window.removeEventListener('keydown', read, true);
      window.removeEventListener('keyup', read, true);
      window.removeEventListener('pointermove', read, true);
    };
  }, [active]);
  return held;
};
