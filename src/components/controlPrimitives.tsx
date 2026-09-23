import React from 'react';
import type { Rgb, Vec2 } from '../engine/effects';

/** Decimal places implied by a step, so 0.01 shows two and 1 shows none. */
const decimalsForStep = (step: number): number => {
  if (!isFinite(step) || step <= 0) return 0;
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
};

/*
 * Every control here carries React Flow's `nodrag` class. Without it, a drag
 * of a slider thumb or a colour swatch also drags the node out from under
 * the pointer.
 *
 * Double-clicking any slider puts it back to its default, as in most
 * compositing and audio tools. For a point, only the axis clicked resets.
 */

/** Labeled slider with its current value shown alongside. */
export const Slider: React.FC<{
  label: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}> = ({ label, value, defaultValue, min, max, step, onChange }) => (
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
      onDoubleClick={() => onChange(defaultValue)}
    />
  </label>
);

/** On/off, as a track that slides rather than a checkbox. */
export const Toggle: React.FC<{
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}> = ({ label, value, onChange }) => (
  <label className="control control-inline">
    <span className="control-label">{label}</span>
    <button
      type="button"
      role="switch"
      aria-checked={value}
      className={'control-toggle nodrag' + (value ? ' is-on' : '')}
      onClick={() => onChange(!value)}
    >
      <span className="control-toggle-knob" />
    </button>
  </label>
);

/** One of a fixed set of modes. Stored as the index, which is what GLSL gets. */
export const Select: React.FC<{
  label: string;
  value: number;
  options: string[];
  onChange: (value: number) => void;
}> = ({ label, value, options, onChange }) => (
  <label className="control control-inline">
    <span className="control-label">{label}</span>
    <select
      className="control-select nodrag"
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value, 10))}
    >
      {options.map((option, index) => (
        <option key={option} value={index}>
          {option}
        </option>
      ))}
    </select>
  </label>
);

/*
 * Colours travel as straight 0..1 RGB because that is what the shader wants;
 * the native picker speaks hex, so it is converted at this boundary only.
 */
const toHex = (rgb: Rgb): string =>
  '#' +
  rgb
    .map((channel) =>
      Math.round(Math.min(1, Math.max(0, channel)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

const fromHex = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

export const ColorField: React.FC<{
  label: string;
  value: Rgb;
  onChange: (value: Rgb) => void;
}> = ({ label, value, onChange }) => (
  <label className="control control-inline">
    <span className="control-label">{label}</span>
    <span className="control-swatch nodrag">
      <input type="color" value={toHex(value)} onChange={(e) => onChange(fromHex(e.target.value))} />
    </span>
  </label>
);

/**
 * A point, as two stacked sliders.
 *
 * Deliberately not an XY pad: at node width a pad would be about forty
 * pixels square, which is worse to aim at than a slider and gives no way to
 * nudge one axis without disturbing the other.
 */
export const Vec2Field: React.FC<{
  label: string;
  value: Vec2;
  defaultValue: Vec2;
  min: number;
  max: number;
  step: number;
  onChange: (value: Vec2) => void;
}> = ({ label, value, defaultValue, min, max, step, onChange }) => {
  const decimals = decimalsForStep(step);
  return (
    <div className="control">
      <span className="control-label">{label}</span>
      {([0, 1] as const).map((axis) => {
        const name = axis === 0 ? 'X' : 'Y';
        return (
          <label key={axis} className="control-axis">
            <span className="control-axis-name">{name}</span>
            <input
              className="control-slider nodrag"
              type="range"
              aria-label={label + ' ' + name}
              min={min}
              max={max}
              step={step}
              value={value[axis]}
              onChange={(e) => {
                const next: Vec2 = [value[0], value[1]];
                next[axis] = parseFloat(e.target.value);
                onChange(next);
              }}
              onDoubleClick={() => {
                const next: Vec2 = [value[0], value[1]];
                next[axis] = defaultValue[axis];
                onChange(next);
              }}
            />
            <span className="control-value">{value[axis].toFixed(decimals)}</span>
          </label>
        );
      })}
    </div>
  );
};
