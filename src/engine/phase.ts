/**
 * Phase: how far a speed-like param has carried its effect by a given time.
 *
 * A scroll or a roll driven by `u_time * speed` jumps the moment the speed
 * changes, because the whole of elapsed time is re-multiplied by the new
 * value. Driving it by the integral of speed instead is what lets an LFO on
 * a roll speed it up and slow it down smoothly.
 *
 * The integral used to be accumulated per viewer from each frame's delta,
 * which made it a function of how the frames happened to fall: two viewers
 * disagreed, and an export -- starting from nothing -- rendered at phase
 * zero whatever time it was asked for. Here it is a function of time alone:
 *
 *   - a constant rate is exact, `time * rate`;
 *   - a modulated rate is integrated from zero on a fixed grid, so every
 *     caller asking about the same moment gets the same answer. Progress is
 *     cached per track, so playback costs one or two samples a frame; going
 *     backwards, or changing what the rate depends on, starts again from
 *     zero.
 */

/**
 * Phases are handed to shaders wrapped to [0, PHASE_WRAP), for the same
 * reason the clock wraps: highp float runs out of digits. The period is an
 * integer so anything periodic in whole units of phase -- `fract(phase)`,
 * `sin(TAU * phase)` -- carries on seamlessly across the wrap. The
 * arithmetic itself happens in doubles, so wrapping costs no precision.
 */
export const PHASE_WRAP = 1000;

/**
 * Integration step for modulated rates, in seconds.
 *
 * The grid never widens: a coarser step for a long jump would make the answer
 * depend on which time a track was first asked about, and a viewer opened at
 * t = 600 would disagree with an export starting fresh. The clock wraps at
 * 1000 s, so a full recompute is at most 120k samples -- a few milliseconds.
 */
export const PHASE_STEP = 1 / 120;

/** Wrap into [0, period), for negative phases too. */
export const wrapPhase = (phase: number, period: number = PHASE_WRAP): number => {
  if (!Number.isFinite(period)) return phase;
  const wrapped = phase % period;
  return wrapped < 0 ? wrapped + period : wrapped;
};

/** A constant rate: exact, and needs no state. */
export const constantPhase = (time: number, rate: number, period: number = PHASE_WRAP): number =>
  wrapPhase(Math.max(0, time) * rate, period);

type Track = {
  identity: string;
  /** Grid points integrated so far: the sum below covers [0, n * step]. */
  n: number;
  sum: number;
};

/**
 * Integrates rate functions of time, one cached track per key.
 *
 * `identity` names everything the rate function depends on. A track whose
 * identity changes is recomputed from zero -- that is what keeps the result
 * a pure function of (identity, time) rather than of the path taken to get
 * there.
 */
export class PhaseIntegrator {
  private tracks = new Map<string, Track>();

  integrate(
    key: string,
    time: number,
    identity: string,
    rate: (t: number) => number,
    period: number = PHASE_WRAP,
  ): number {
    if (!(time > 0)) return 0;
    let track = this.tracks.get(key);
    const fresh = (): Track => ({ identity, n: 0, sum: 0 });

    if (!track || track.identity !== identity || time < track.n * PHASE_STEP) {
      track = fresh();
      this.tracks.set(key, track);
    }

    // Midpoint rule on the grid: exact for linear rates, and an LFO at any
    // sensible frequency is smooth over 1/120 s.
    const step = PHASE_STEP;
    const target = Math.floor(time / step);
    let { n, sum } = track;
    while (n < target) {
      sum = wrapPhase(sum + step * finite(rate((n + 0.5) * step)), period);
      n += 1;
    }
    track.n = n;
    track.sum = sum;

    const rest = time - n * step;
    const partial = rest > 0 ? rest * finite(rate(n * step + rest / 2)) : 0;
    return wrapPhase(sum + partial, period);
  }

  /** Drop every track whose key is not in `live`. */
  prune(live: Set<string>): void {
    for (const key of this.tracks.keys()) if (!live.has(key)) this.tracks.delete(key);
  }

  clear(): void {
    this.tracks.clear();
  }
}

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);
