/**
 * The one clock everything animated reads.
 *
 * Shared rather than kept per viewer, so two viewers watching the same LFO
 * swing in step, and a slider showing where its modulation has taken it
 * shows the value the picture is actually using at that moment.
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

const start = performance.now();

/** Seconds since the app started, wrapped. What shaders see as `u_time`. */
export const clockSeconds = (now: number = performance.now()): number =>
  ((now - start) / 1000) % TIME_WRAP;
