import { beforeEach, describe, expect, it } from 'vitest';
import { HISTORY_SECONDS, clearStatistics, readStatistic, setStatistics, type Statistics } from './statistics';
import { defaultModulatorParams, evaluateSignal, smoothSignal, statistic, type Signal } from './modulators';

const NODE = 'stat-test';
/** A reading whose every statistic is `v`. */
const flat = (v: number): Statistics => [v, v, v, v, v];

beforeEach(() => clearStatistics(NODE));

describe('Image Statistic history', () => {
  it('reads the newest reading at or after it, and the line between readings before', () => {
    setStatistics(NODE, flat(0), 1);
    setStatistics(NODE, flat(1), 2);
    expect(readStatistic(NODE, 0)).toBe(1);
    expect(readStatistic(NODE, 0, 5)).toBe(1);
    expect(readStatistic(NODE, 0, 1.25)).toBeCloseTo(0.25);
    expect(readStatistic(NODE, 0, 0)).toBe(0);
  });

  it('slots a slightly late reading into place, and keeps one per moment', () => {
    setStatistics(NODE, flat(0), 1);
    setStatistics(NODE, flat(1), 2);
    setStatistics(NODE, flat(0.5), 1.5);
    setStatistics(NODE, flat(0.9), 2);
    expect(readStatistic(NODE, 0, 1.5)).toBeCloseTo(0.5);
    expect(readStatistic(NODE, 0, 1.75)).toBeCloseTo(0.7);
  });

  it('starts over when time jumps back, as on a seek or an export from 0', () => {
    setStatistics(NODE, flat(1), 50);
    setStatistics(NODE, flat(0.2), 0);
    expect(readStatistic(NODE, 0, 40)).toBe(0.2);
  });

  it('keeps only the last few seconds', () => {
    for (let t = 0; t <= 30; t += 0.5) setStatistics(NODE, flat(t), t);
    // Older than the window: answered with the oldest reading kept.
    expect(readStatistic(NODE, 0, 1)).toBeCloseTo(30 - HISTORY_SECONDS);
  });

  it('lets Smooth look back through a statistic', () => {
    // Dark until 10 s, then bright.
    for (let t = 0; t <= 12; t += 1 / 30) setStatistics(NODE, flat(t < 10 ? 0 : 1), t);
    const stat: Signal = { def: statistic, params: defaultModulatorParams(statistic), seed: 0, inputs: {}, nodeId: NODE };
    const smoothed: Signal = {
      def: smoothSignal,
      params: { ...defaultModulatorParams(smoothSignal), time: 1 },
      seed: 0,
      inputs: { input: stat },
    };
    const justAfter = evaluateSignal(smoothed, 10.2);
    expect(justAfter).toBeGreaterThan(0.05);
    expect(justAfter).toBeLessThan(0.95);
    expect(evaluateSignal(smoothed, 11.99)).toBeGreaterThan(evaluateSignal(smoothed, 10.5));
  });
});
