import { describe, expect, it } from 'vitest';
import { getEffect } from '../registry';
import { passesOf } from '../effects';
import { SORT_LOG, SORT_STEPS, pixelSort, sortPartner, sortStep } from './pixelSort';

/**
 * The shader's passes replayed on one row in JS: the same scan, the same
 * network, the same comparator. Returns, for each output position, the
 * index of the pixel that lands there.
 */
const simulate = (keys: number[], inRange: boolean[], maxLength: number): number[] => {
  const n = keys.length;
  const size = 1 << SORT_LOG;
  type Cell = { seg: number; orig: number; key: number };

  let runs = keys.map((_, i) => (i % size === 0 || inRange[i] !== inRange[i - 1] ? i : -1));
  for (let k = 0; k < SORT_LOG; k += 1) {
    const stride = 1 << k;
    runs = runs.map((v, i) => (i % size >= stride ? Math.max(v, runs[i - stride]) : v));
  }
  let cells: Cell[] = keys.map((key, i) => ({
    seg: inRange[i] ? runs[i] + Math.floor((i - runs[i]) / maxLength) * maxLength : i,
    orig: i,
    key,
  }));

  const before = (a: Cell, b: Cell) =>
    a.seg !== b.seg ? a.seg < b.seg : a.key !== b.key ? a.key < b.key : a.orig < b.orig;

  for (let t = 0; t < SORT_STEPS; t += 1) {
    const { stage, step } = sortStep(t);
    cells = cells.map((self, along) => {
      const base = along - (along % size);
      const local = along - base;
      const partner = sortPartner(local, stage, step);
      if (base + partner >= n || partner >= size) return self;
      const other = cells[base + partner];
      return local < partner === before(other, self) ? other : self;
    });
  }
  return cells.map((cell) => cell.orig);
};

/** What the result should be: each in-range run (cut to maxLength) sorted on its own. */
const expected = (keys: number[], inRange: boolean[], maxLength: number): number[] => {
  const out = keys.map((_, i) => i);
  let i = 0;
  while (i < keys.length) {
    if (!inRange[i]) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < keys.length && inRange[end]) end += 1;
    for (let start = i; start < end; start += maxLength) {
      const piece = out.slice(start, Math.min(start + maxLength, end));
      piece.sort((a, b) => keys[a] - keys[b] || a - b);
      out.splice(start, piece.length, ...piece);
    }
    i = end;
  }
  return out;
};

const random = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

describe('Pixel Sort', () => {
  it('is registered as a float-scratch effect with init, scan, sort and resolve passes', () => {
    expect(getEffect('pixelSort')).toBe(pixelSort);
    expect(pixelSort.scratch).toBe('float');
    expect(passesOf(pixelSort)).toHaveLength(1 + SORT_LOG + SORT_STEPS + 1);
    // All one text, so the pipeline compiles it once.
    expect(new Set(passesOf(pixelSort)).size).toBe(1);
  });

  it('walks every stage once, each from its flip down to stride 1', () => {
    const steps = Array.from({ length: SORT_STEPS }, (_, t) => sortStep(t));
    expect(steps.slice(0, 6)).toEqual([
      { stage: 0, step: 0 },
      { stage: 1, step: 1 },
      { stage: 1, step: 0 },
      { stage: 2, step: 2 },
      { stage: 2, step: 1 },
      { stage: 2, step: 0 },
    ]);
    expect(steps[steps.length - 1]).toEqual({ stage: SORT_LOG - 1, step: 0 });
  });

  it.each([1, 2, 7, 100, 333, 1000])('sorts a whole row of %i pixels', (n) => {
    const next = random(n);
    const keys = Array.from({ length: n }, () => Math.round(next() * 20) / 20);
    const all = keys.map(() => true);
    expect(simulate(keys, all, 1e9)).toEqual(expected(keys, all, 1e9));
  });

  it('sorts only inside runs, and leaves everything outside them in place', () => {
    const next = random(42);
    const keys = Array.from({ length: 517 }, () => next());
    const inRange = keys.map((k) => k > 0.3);
    const result = simulate(keys, inRange, 1e9);
    expect(result).toEqual(expected(keys, inRange, 1e9));
    inRange.forEach((sorted, i) => {
      if (!sorted) expect(result[i]).toBe(i);
    });
  });

  it('cuts long runs into Max Length pieces', () => {
    const next = random(7);
    const keys = Array.from({ length: 300 }, () => next());
    const inRange = keys.map((_, i) => i % 97 !== 0);
    expect(simulate(keys, inRange, 16)).toEqual(expected(keys, inRange, 16));
  });

  it('sorts a row longer than the network in independent pieces', () => {
    const next = random(3);
    const n = (1 << SORT_LOG) + 50;
    const keys = Array.from({ length: n }, () => next());
    const all = keys.map(() => true);
    const result = simulate(keys, all, 1e9);
    // The scan restarts at the boundary, so each piece sorts on its own.
    const first = result.slice(0, 1 << SORT_LOG).map((i) => keys[i]);
    const second = result.slice(1 << SORT_LOG).map((i) => keys[i]);
    expect(first).toEqual([...first].sort((a, b) => a - b));
    expect(second).toEqual([...second].sort((a, b) => a - b));
    expect(result.slice(1 << SORT_LOG).every((i) => i >= 1 << SORT_LOG)).toBe(true);
  });
});
