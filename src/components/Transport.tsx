import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  clockSeconds,
  isPlaying,
  resetClock,
  subscribeClock,
  togglePlaying,
} from '../engine/clock';

/**
 * How long each tile takes to roll to its next digit, in milliseconds,
 * from the hundreds of seconds down to the hundredths. A roll has to
 * finish before the digit changes again, so the tenths roll quickly and
 * the last hundredths digit -- changing every ten milliseconds -- flips
 * without rolling at all, where a roll would only be a blur.
 */
const ROLL_MS = [200, 200, 200, 70, 0];

/** How many of the tiles are whole seconds; the rest are hundredths. */
const SECOND_TILES = 3;

/** Cells on each strip: 0-9, and a spare 0 to roll onto after 9. */
const CELLS = 11;

/** One digit per tile: seconds (000-999, as the clock wraps at 1000), then hundredths. */
const digitsAt = (seconds: number): number[] => {
  const hundredths = Math.floor(seconds * 100);
  const whole = Math.floor(hundredths / 100) % 1000;
  const fraction = hundredths % 100;
  return [Math.floor(whole / 100), Math.floor(whole / 10) % 10, whole % 10, Math.floor(fraction / 10), fraction % 10];
};

/**
 * A tape deck's counter: seconds and hundredths on little tiles, each
 * digit a strip of 0-9 that rolls upward as it counts.
 *
 * The strip carries a second 0 after the 9, so 9 to 0 keeps rolling up
 * onto it and then snaps back to the first 0 unseen, instead of spinning
 * back down through the whole strip. Only a step of one while playing
 * rolls; a reset or a resume jumps straight to the new digit.
 *
 * Painted straight to the DOM from a frame loop rather than through React
 * state, so the rest of the bar does not re-render sixty times a second.
 */
const DeckCounter: React.FC<{ playing: boolean }> = ({ playing }) => {
  const strips = useRef<(HTMLSpanElement | null)[]>([]);
  // The digit each tile is showing, so a change can be told from a repeat.
  const shown = useRef<number[]>([]);

  useEffect(() => {
    const place = (strip: HTMLSpanElement, cell: number, ms: number) => {
      strip.style.transition = ms > 0 ? `transform ${ms}ms cubic-bezier(0.2, 0.7, 0.2, 1)` : 'none';
      // A translate percentage is of the strip's own height, and the strip
      // is CELLS tiles tall, so one cell is 100 / CELLS of it.
      strip.style.transform = `translateY(${(-cell * 100) / CELLS}%)`;
    };

    const paint = (roll: boolean) => {
      digitsAt(clockSeconds()).forEach((digit, i) => {
        const strip = strips.current[i];
        const previous = shown.current[i];
        if (!strip || previous === digit) return;
        shown.current[i] = digit;
        const step = previous !== undefined && digit === (previous + 1) % 10;
        if (!roll || !step || ROLL_MS[i] === 0) {
          place(strip, digit, 0);
          return;
        }
        if (digit !== 0) {
          place(strip, digit, ROLL_MS[i]);
          return;
        }
        // 9 to 0: roll onto the spare 0 at the end, then jump back to the
        // first one, which looks identical.
        place(strip, 10, ROLL_MS[i]);
        strip.addEventListener(
          'transitionend',
          () => {
            if (shown.current[i] === 0) place(strip, 0, 0);
          },
          { once: true },
        );
      });
    };

    paint(false);
    // Resets arrive as clock events, and jump rather than roll.
    const unsubscribe = subscribeClock(() => paint(false));
    if (!playing) return unsubscribe;
    let frame = requestAnimationFrame(function tick() {
      paint(true);
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [playing]);

  return (
    <span className="deck" role="timer" aria-label="Time in seconds">
      {ROLL_MS.map((_, i) => (
        <span key={i} className={'deck-tile' + (i >= SECOND_TILES ? ' is-fraction' : '')} aria-hidden="true">
          <span
            className="deck-strip"
            ref={(el) => {
              strips.current[i] = el;
            }}
          >
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d, cell) => (
              <span key={cell} className="deck-digit">
                {d}
              </span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
};

/**
 * Play and pause as one shape that changes its mind.
 *
 * Two halves, each clipped by a polygon of four points: as the two bars of
 * pause, or as the upper and lower halves of the play triangle. The points
 * correspond one to one, so a CSS transition on `clip-path` folds one
 * shape into the other -- no second icon swapped in, and no library.
 */
const PlayPauseGlyph: React.FC<{ playing: boolean }> = ({ playing }) => (
  <span className={'glyph-playpause' + (playing ? ' is-playing' : '')} aria-hidden="true">
    <span className="glyph-half glyph-half-a" />
    <span className="glyph-half glyph-half-b" />
  </span>
);

/**
 * The transport, top centre: back to zero, play/pause, and the time.
 *
 * Space plays and pauses from anywhere on the canvas (see
 * useCanvasShortcuts); these buttons are for the pointer. They carry
 * `data-transport`, so a Space pressed while one has focus is taken as the
 * shortcut rather than also clicking the button and toggling twice.
 */
export const Transport: React.FC = () => {
  const playing = useSyncExternalStore(subscribeClock, isPlaying);

  return (
    <div className={'glass transport' + (playing ? ' is-playing' : '')}>
      <button
        type="button"
        className="transport-button"
        data-transport
        onClick={resetClock}
        title="Back to 0 (R)"
        aria-label="Back to time 0"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="3" y="3" width="2" height="10" rx="0.6" />
          <path d="M13 3.6v8.8a.6.6 0 0 1-.92.5L6.6 8.5a.6.6 0 0 1 0-1l5.48-4.4a.6.6 0 0 1 .92.5z" />
        </svg>
      </button>

      <button
        type="button"
        className="transport-button transport-play"
        data-transport
        onClick={togglePlaying}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        <PlayPauseGlyph playing={playing} />
      </button>

      <span className="transport-sep" />
      <DeckCounter playing={playing} />
    </div>
  );
};
