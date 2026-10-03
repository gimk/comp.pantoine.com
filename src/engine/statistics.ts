/**
 * What each Image Statistic node has measured lately, by node id.
 *
 * The one place a picture turns back into a number -- Blender's Attribute
 * Statistic, for pixels. The renderer measures the picture as part of the
 * frame, before anything that reads the result is drawn, and writes it
 * here; the node's signal reads it back. Kept outside the store for the
 * same reason decoded images are: it changes every frame, and none of it
 * belongs in a saved document or an undo step.
 */

/** In the order of the node's Statistic menu. */
export const STATISTICS = ['Mean', 'Minimum', 'Maximum', 'Range', 'Std Dev'] as const;

/** One measurement: a value per entry of `STATISTICS`. */
export type Statistics = [number, number, number, number, number];

/**
 * Every node's recent readings, oldest first, each stamped with the clock
 * time of the frame it was measured for.
 *
 * Kept so a modulator that looks back -- Smooth, Sample & Hold, Envelope
 * -- can ask what the statistic was a moment ago, as it asks any other
 * signal. The window covers the furthest any of them looks back. Time
 * going backwards by more than a stutter -- a seek, a reset, an export
 * starting from 0, the clock wrapping -- is a new timeline, and the old
 * readings would only lie about it, so they go.
 */
const history = new Map<string, { time: number; stats: Statistics }[]>();

/** Seconds of readings kept: past the longest lookback (Smooth's 10 s). */
export const HISTORY_SECONDS = 12;
/** A cap on readings, whatever the frame rate. */
const MAX_READINGS = 2048;
/**
 * How far back a reading may land before it counts as a new timeline.
 * Viewers each measure on their own frame, so readings can arrive a
 * frame or two out of order; those are slotted in, not a reset.
 */
const REWIND = 0.5;

export const setStatistics = (nodeId: string, stats: Statistics, time = 0): void => {
  let readings = history.get(nodeId);
  if (!readings) {
    readings = [];
    history.set(nodeId, readings);
  }
  const last = readings[readings.length - 1];
  if (last && time < last.time - REWIND) readings.length = 0;

  // In time order; one reading per moment, the newest measurement winning.
  let at = readings.length;
  while (at > 0 && readings[at - 1].time > time) at -= 1;
  if (at > 0 && readings[at - 1].time === time) readings[at - 1] = { time, stats };
  else readings.splice(at, 0, { time, stats });

  const newest = readings[readings.length - 1].time;
  let stale = 0;
  while (stale < readings.length - 1 && readings[stale].time < newest - HISTORY_SECONDS) stale += 1;
  stale = Math.max(stale, readings.length - MAX_READINGS);
  if (stale > 0) readings.splice(0, stale);
};

/**
 * A statistic of what the node measured at `time`: between two readings,
 * the line between them; past the newest, the newest -- the live reading
 * -- and before the oldest, the oldest. Without a time, the newest. 0
 * before it has measured anything.
 */
export const readStatistic = (nodeId: string | undefined, index: number, time?: number): number => {
  if (nodeId === undefined) return 0;
  const readings = history.get(nodeId);
  if (!readings || readings.length === 0) return 0;
  const k = Math.min(STATISTICS.length - 1, Math.max(0, index));
  const newest = readings[readings.length - 1];
  if (time === undefined || time >= newest.time) return newest.stats[k];
  if (time <= readings[0].time) return readings[0].stats[k];
  // The first reading after `time`, by halving.
  let lo = 0;
  let hi = readings.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (readings[mid].time <= time) lo = mid;
    else hi = mid;
  }
  const a = readings[lo];
  const b = readings[hi];
  const t = (time - a.time) / (b.time - a.time);
  return a.stats[k] + (b.stats[k] - a.stats[k]) * t;
};

/** Forget a node's readings -- for tests, and a node that is gone. */
export const clearStatistics = (nodeId: string): void => {
  history.delete(nodeId);
};

/**
 * Summary statistics of the luminance of a set of RGBA samples, as
 * Blender turns a colour into a float. Samples with alpha 0 are skipped --
 * an unwired or empty input reads as transparent black, and counting it
 * would drag the mean towards zero.
 */
export const summarize = (rgba: ArrayLike<number>, scale = 1): Statistics => {
  let count = 0;
  let sum = 0;
  let sumSq = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] <= 0) continue;
    const luma = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / scale;
    count += 1;
    sum += luma;
    sumSq += luma * luma;
    if (luma < min) min = luma;
    if (luma > max) max = luma;
  }
  if (count === 0) return [0, 0, 0, 0, 0];
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  return [mean, min, max, max - min, Math.sqrt(variance)];
};
