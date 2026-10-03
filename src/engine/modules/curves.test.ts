import { describe, expect, it } from 'vitest';
import { getEffect } from '../registry';
import { defaultParams, paramsOf, type Vec2 } from '../effects';
import { CURVE_IDS, curves, evalCurve, readCurve, writeCurve } from './curves';

const random = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

/** Sorted points with distinct x, rising or falling at random. */
const randomCurve = (next: () => number, count: number): Vec2[] => {
  const xs = new Set<number>();
  while (xs.size < count) xs.add(Math.round(next() * 1000) / 1000);
  return [...xs].sort((a, b) => a - b).map((x) => [x, next()] as Vec2);
};

describe('Curves', () => {
  it('is registered, with every point param hidden and portless', () => {
    expect(getEffect('curves')).toBe(curves);
    for (const spec of paramsOf(curves)) {
      if (spec.key === 'mix') continue;
      expect(spec.hidden).toBe(true);
      expect(spec.portless).toBe(true);
    }
  });

  it('starts as the identity on every curve', () => {
    const params = defaultParams(curves);
    for (const id of CURVE_IDS) {
      const points = readCurve(params, id);
      for (let x = 0; x <= 1; x += 0.05) expect(evalCurve(points, x)).toBeCloseTo(x, 6);
    }
  });

  it('round-trips points through params, sorted by x', () => {
    const patch = writeCurve('r', [
      [1, 0.9],
      [0, 0.1],
      [0.4, 0.6],
    ]);
    expect(readCurve(patch, 'r')).toEqual([
      [0, 0.1],
      [0.4, 0.6],
      [1, 0.9],
    ]);
  });

  it('passes through every point and stays flat past the ends', () => {
    const next = random(11);
    for (let trial = 0; trial < 20; trial += 1) {
      const points = randomCurve(next, 2 + (trial % 7));
      for (const [x, y] of points) expect(evalCurve(points, x)).toBeCloseTo(y, 6);
      expect(evalCurve(points, points[0][0] - 0.01)).toBe(points[0][1]);
      expect(evalCurve(points, points[points.length - 1][0] + 0.01)).toBe(points[points.length - 1][1]);
    }
  });

  it('never overshoots: between two points it stays between their values', () => {
    const next = random(5);
    for (let trial = 0; trial < 50; trial += 1) {
      const points = randomCurve(next, 3 + (trial % 6));
      for (let k = 0; k < points.length - 1; k += 1) {
        const [ax, ay] = points[k];
        const [bx, by] = points[k + 1];
        const lo = Math.min(ay, by) - 1e-9;
        const hi = Math.max(ay, by) + 1e-9;
        let previous = ay;
        for (let i = 1; i <= 20; i += 1) {
          const y = evalCurve(points, ax + ((bx - ax) * i) / 20);
          expect(y).toBeGreaterThanOrEqual(lo);
          expect(y).toBeLessThanOrEqual(hi);
          // Monotone within the segment, in the direction it runs.
          if (by >= ay) expect(y).toBeGreaterThanOrEqual(previous - 1e-9);
          else expect(y).toBeLessThanOrEqual(previous + 1e-9);
          previous = y;
        }
      }
    }
  });
});
