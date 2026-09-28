/**
 * What each Image Statistic node last measured, by node id.
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

const measured = new Map<string, Statistics>();

export const setStatistics = (nodeId: string, stats: Statistics): void => {
  measured.set(nodeId, stats);
};

/** A statistic of what the node last measured; 0 before it has measured anything. */
export const readStatistic = (nodeId: string | undefined, index: number): number => {
  if (nodeId === undefined) return 0;
  const stats = measured.get(nodeId);
  return stats ? stats[Math.min(STATISTICS.length - 1, Math.max(0, index))] : 0;
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
