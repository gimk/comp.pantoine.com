import React from 'react';

/** Decimal places implied by a step, so 0.01 shows two and 1 shows none. */
const decimalsForStep = (step: number): number => {
  if (!isFinite(step) || step <= 0) return 0;
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
};

/**
 * Labeled slider with its current value shown alongside.
 *
 * Carries React Flow's `nodrag` class: without it, every drag of the thumb
 * would also drag the node out from under the pointer.
 */
export const Slider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step, onChange }) => (
  <label className="control">
    <span className="control-row">
      <span className="control-label">{label}</span>
      <span className="control-value">{value.toFixed(decimalsForStep(step))}</span>
    </span>
    <input
      className="control-slider nodrag"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
    />
  </label>
);
