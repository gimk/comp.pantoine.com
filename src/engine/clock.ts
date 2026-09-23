/**
 * The one clock everything animated reads -- and the transport that runs it.
 *
 * Shared rather than kept per viewer, so two viewers watching the same LFO
 * swing in step, and a slider showing where its modulation has taken it
 * shows the value the picture is actually using at that moment. Pausing
 * it pauses everything at once; resetting it sends everything back to
 * zero together.
 */

/**
 * Seconds before the clock wraps.
 *
 * `highp float` carries about seven significant digits, so an app left open
 * for hours would quantise `sin(u_time * rate)` into visible steps. Wrapping
 * trades that for one discontinuity every ~17 minutes, which is the better
 * of the two artefacts by a wide margin.
 */
const TIME_WRAP = 1000;

/** The moment that counts as time zero, moved forward by every pause. */
let origin = performance.now();
/** When the clock was paused, or null while it runs. */
let pausedAt: number | null = null;
/** Bumped by every reset, so viewers know to drop their feedback history. */
let resets = 0;

const listeners = new Set<() => void>();
const notify = (): void => {
  for (const listener of listeners) listener();
};

/** Seconds since time zero, wrapped. What shaders see as `u_time`. */
export const clockSeconds = (now: number = performance.now()): number =>
  (((pausedAt ?? now) - origin) / 1000) % TIME_WRAP;

export const isPlaying = (): boolean => pausedAt === null;

/** How many times the clock has been sent back to zero. */
export const resetCount = (): number => resets;

export const play = (): void => {
  if (pausedAt === null) return;
  // The paused stretch is cut out of the timeline, so time resumes from
  // where it stopped rather than jumping ahead by however long it sat.
  origin += performance.now() - pausedAt;
  pausedAt = null;
  notify();
};

export const pause = (): void => {
  if (pausedAt !== null) return;
  pausedAt = performance.now();
  notify();
};

export const togglePlaying = (): void => (isPlaying() ? pause() : play());

/** Back to zero, keeping whether it is playing or paused. */
export const resetClock = (): void => {
  const now = performance.now();
  origin = now;
  if (pausedAt !== null) pausedAt = now;
  resets += 1;
  notify();
};

/** For `useSyncExternalStore`: called on play, pause and reset. */
export const subscribeClock = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
