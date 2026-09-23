import React, { useEffect, useRef, useState } from 'react';
import type { Rgb, Vec2 } from '../engine/effects';
import { clockSeconds } from '../engine/clock';

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

/**
 * The value a wired param is receiving, for showing on it. `read` is
 * called with the shared clock; `moving` says whether it is worth calling
 * every frame or once is enough.
 */
export type LiveReading = {
  read: (time: number) => number;
  moving: boolean;
  /**
   * Worked out by the node from its inputs rather than arriving on a wire
   * -- Map Range's From range under Auto range. Shown locked the same way,
   * but in grey: it is a consequence, not a signal.
   */
  derived?: boolean;
};

const lockClass = (live: LiveReading | undefined): string =>
  !live ? '' : live.derived ? ' is-derived' : ' is-wired';

/**
 * Paint a live value into the DOM, every frame while it moves.
 *
 * Straight to the elements rather than through React state, so a card full
 * of wired params does not re-render sixty times a second.
 */
const useLivePaint = (live: LiveReading | undefined, paint: (value: number) => void, deps: unknown[]): void => {
  useEffect(() => {
    if (!live) return;
    const draw = () => paint(live.read(clockSeconds()));
    draw();
    if (!live.moving) return;
    let frame = requestAnimationFrame(function tick() {
      draw();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
    // `paint` is recreated every render and only reads refs, so it is left
    // out; the caller names what the painting actually depends on.
  }, [live, ...deps]);
};

/** Half the thumb's width in the stylesheet, so the dot lines up with it. */
const THUMB_HALF = 6.5;

/**
 * Labeled slider with its current value shown alongside.
 *
 * With a wire in, the param takes the signal's value outright, so the
 * slider is locked -- as a connected socket is in a node editor. The
 * number shows the value arriving, in the signal's amber, and a dot on the
 * track shows where it sits. Take the wire out and the slider is back
 * where it was left.
 */
export const Slider: React.FC<{
  label: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  live?: LiveReading;
}> = ({ label, value, defaultValue, min, max, step, onChange, live }) => {
  const decimals = decimalsForStep(step);
  const valueRef = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);

  useLivePaint(
    live,
    (current) => {
      // Held on the track: a value past the slider's end sits at the end.
      const t = max > min ? clampTo((current - min) / (max - min), 0, 1) : 0;
      if (valueRef.current) valueRef.current.textContent = current.toFixed(decimals);
      if (dotRef.current) dotRef.current.style.left = `calc(${THUMB_HALF}px + (100% - ${THUMB_HALF * 2}px) * ${t})`;
    },
    [decimals, min, max],
  );

  return (
    // A div rather than a label: a label forwards any click inside it to
    // the range input, which would swallow a click meant for the number.
    <div className={'control' + lockClass(live)}>
      <span className="control-row">
        <span className="control-label">{label}</span>
        {live ? (
          // Keyed on being wired: the frame loop writes this text behind
          // React's back, so when the wire comes off the element is
          // replaced rather than left showing the last value it received.
          <span className="control-value" ref={valueRef} key="wired" />
        ) : (
          <TypedValue
            value={value}
            decimals={decimals}
            label={label}
            // The slider's maximum is only where the slider stops: a typed
            // value may go past it. Its minimum still holds, since that is
            // what keeps an effect out of values that break it. Not snapped
            // to the step, so a value between notches can be typed too.
            onCommit={(typed) => onChange(Math.max(step === 1 ? Math.round(typed) : typed, min))}
          />
        )}
      </span>
      <span className="control-track">
        <input
          className="control-slider nodrag"
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={!!live}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onDoubleClick={() => onChange(defaultValue)}
        />
        {live && <span className="control-live-dot" ref={dotRef} aria-hidden="true" />}
      </span>
    </div>
  );
};

const clampTo = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/**
 * A slider's number, which turns into a text box when clicked -- for the
 * exact value a drag is too coarse to land on.
 *
 * Enter or clicking away commits; Escape puts it back. Anything that does
 * not parse as a number is dropped rather than committed as zero.
 */
const TypedValue: React.FC<{
  value: number;
  decimals: number;
  label: string;
  onCommit: (value: number) => void;
}> = ({ value, decimals, label, onCommit }) => {
  const [editing, setEditing] = useState(false);
  // Set by Escape, so the blur that follows closing the box does not
  // commit what was just abandoned.
  const cancelled = useRef(false);

  if (!editing) {
    return (
      <button
        type="button"
        className="control-value control-value-button nodrag"
        title="Click to type a value"
        aria-label={`${label}: ${value.toFixed(decimals)}. Click to type a value`}
        onClick={() => {
          cancelled.current = false;
          setEditing(true);
        }}
      >
        {value.toFixed(decimals)}
      </button>
    );
  }

  const finish = (text: string) => {
    setEditing(false);
    if (cancelled.current) return;
    const typed = parseFloat(text);
    if (Number.isFinite(typed)) onCommit(typed);
  };

  return (
    <input
      className="control-value-edit nodrag"
      type="text"
      inputMode="decimal"
      aria-label={label}
      defaultValue={value.toFixed(decimals)}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
};

/**
 * A free number, typed in -- for values with no natural range, like a Map
 * Range's bounds or a Math node's operands.
 *
 * Commits on every keystroke that parses, so the picture follows as you
 * type; a half-typed "-" or "." is left alone rather than snapped to 0.
 * The text is the field's own while it has focus, and follows the stored
 * value otherwise -- so an undo shows up in it, but never rewrites what is
 * being typed. Wired, the field gives way to the value arriving, as the
 * slider does.
 */
export const NumberField: React.FC<{
  label: string;
  value: number;
  step: number;
  onChange: (value: number) => void;
  live?: LiveReading;
}> = ({ label, value, step, onChange, live }) => {
  const valueRef = useRef<HTMLSpanElement>(null);
  const focused = useRef(false);
  const [text, setText] = useState(() => formatFree(value));

  useEffect(() => {
    if (!focused.current) setText(formatFree(value));
  }, [value]);

  useLivePaint(
    live,
    (current) => {
      if (valueRef.current) valueRef.current.textContent = formatFree(current);
    },
    [],
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const scrub = useScrub(value, step, onChange, () => inputRef.current?.focus());

  return (
    // A div rather than a label: a label would also focus the box at the
    // end of every scrub, since a drag on it still ends in a click.
    <div className={'control control-inline' + lockClass(live)}>
      {live ? (
        <span className="control-label">{label}</span>
      ) : (
        <span className="control-label control-scrub nodrag" title="Drag to change · Shift faster · Alt finer" {...scrub}>
          {label}
        </span>
      )}
      {live ? (
        <span className="control-value control-field-live" ref={valueRef} />
      ) : (
        <input
          ref={inputRef}
          className="control-field nodrag"
          type="number"
          aria-label={label}
          step={step}
          value={text}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            setText(formatFree(value));
          }}
          onChange={(e) => {
            setText(e.target.value);
            const next = parseFloat(e.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
      )}
    </div>
  );
};

/** Pointer travel, in pixels, before a press on the label counts as a drag. */
const SCRUB_THRESHOLD = 2;

/**
 * Figma's scrubbing: drag a field's label sideways to change its value.
 *
 * How far one pixel moves the value follows the value's own size -- a
 * hundredth of its order of magnitude -- so the same gesture sweeps a line
 * count through the hundreds and eases a factor through its hundredths,
 * and never less than the field's step. Shift is ten times faster, Alt ten
 * times finer. The rate is fixed when the drag starts, so it does not jump
 * as the value crosses a power of ten under the pointer.
 *
 * A press that barely moves is a click, and puts the caret in the box.
 */
const useScrub = (
  value: number,
  step: number,
  onChange: (value: number) => void,
  onClick: () => void,
): React.HTMLAttributes<HTMLSpanElement> => {
  const drag = useRef<{ x: number; start: number; rate: number; moved: boolean } | null>(null);

  const perPixel = (from: number): number => {
    const magnitude = Math.abs(from) > 0 ? 10 ** Math.floor(Math.log10(Math.abs(from))) : 0;
    return Math.max(step, magnitude / 100);
  };

  return {
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      // No text selection, no focus change, no node drag underneath.
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, start: value, rate: perPixel(value), moved: false };
    },
    onPointerMove: (event) => {
      const current = drag.current;
      if (!current) return;
      const dx = event.clientX - current.x;
      if (!current.moved && Math.abs(dx) < SCRUB_THRESHOLD) return;
      current.moved = true;
      const speed = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
      const increment = current.rate * speed;
      // Rounded to the increment's own precision, so a drag lands on clean
      // figures instead of float residue like 0.30000000000000004.
      const decimals = Math.max(0, -Math.floor(Math.log10(increment)));
      onChange(Number((current.start + dx * increment).toFixed(decimals)));
    },
    onPointerUp: (event) => {
      const current = drag.current;
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (current && !current.moved) onClick();
    },
    onPointerCancel: () => {
      drag.current = null;
    },
  };
};

/** A free number shown to as many places as it needs, up to three. */
const formatFree = (value: number): string => String(Math.round(value * 1000) / 1000);

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
