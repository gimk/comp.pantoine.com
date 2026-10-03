import React, { useEffect, useRef } from 'react';
import type { ParamValue } from '../engine/effects';
import { stepKey, stepValues } from '../engine/modulators';
import { useGraph } from '../state/store';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 100) / 100;

/**
 * A Step Sequencer's steps, as a row of bars: press a bar and drag up or
 * down to set it, or drag across to paint several in one stroke.
 *
 * Painting goes from the step last touched to the one under the pointer,
 * filling the steps in between along the way, so a quick sweep across the
 * row never skips one.
 */
export const StepEditor: React.FC<{ nodeId: string; params: Record<string, ParamValue> }> = ({ nodeId, params }) => {
  const rowRef = useRef<HTMLDivElement>(null);
  // Detaches an in-flight drag's window listeners; also run on unmount so a
  // node deleted mid-drag does not leave them behind.
  const endDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endDragRef.current?.(), []);

  const values = stepValues(params);

  /** The step and value under the pointer, from the row's box. */
  const at = (clientX: number, clientY: number): { index: number; value: number } | null => {
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const index = Math.min(values.length - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * values.length)));
    return { index, value: round(clamp01(1 - (clientY - rect.top) / rect.height)) };
  };

  const paint = (from: { index: number; value: number }, to: { index: number; value: number }) => {
    const patch: Record<string, ParamValue> = {};
    const span = Math.abs(to.index - from.index);
    for (let k = 0; k <= span; k += 1) {
      const index = from.index + Math.sign(to.index - from.index) * k;
      const t = span === 0 ? 1 : k / span;
      patch[stepKey(index)] = round(from.value + (to.value - from.value) * t);
    }
    useGraph.getState().setEffectParams(nodeId, patch);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    endDragRef.current?.();
    let last = at(event.clientX, event.clientY);
    if (!last) return;
    paint(last, last);

    const onMove = (move: PointerEvent) => {
      const next = at(move.clientX, move.clientY);
      if (!next || !last) return;
      paint(last, next);
      last = next;
    };
    const endDrag = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      if (endDragRef.current === endDrag) endDragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    endDragRef.current = endDrag;
  };

  return (
    <div className="step-editor nodrag">
      <div
        ref={rowRef}
        className="step-row"
        role="group"
        aria-label="Steps"
        onPointerDown={handlePointerDown}
        title="Drag up or down to set a step, across to paint several"
      >
        {values.map((value, index) => (
          <div key={index} className="step-cell">
            <div className="step-bar" style={{ height: `${Math.max(value, 0.02) * 100}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
};
