import { describe, expect, it } from 'vitest';
import { getEffect } from '../registry';
import type { Vec2 } from '../effects';
import { applyHomography, cornerPin, quadToSquare, squareToQuad } from './cornerPin';

const random = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

describe('Corner Pin', () => {
  it('is registered', () => {
    expect(getEffect('cornerPin')).toBe(cornerPin);
  });

  it('is the identity at the frame corners', () => {
    const map = squareToQuad([0, 0], [1, 0], [1, 1], [0, 1]);
    for (const p of [[0.3, 0.7], [0.9, 0.1], [0.5, 0.5]] as Vec2[]) {
      const [x, y] = applyHomography(map, p);
      expect(x).toBeCloseTo(p[0], 9);
      expect(y).toBeCloseTo(p[1], 9);
    }
  });

  it('takes each corner of the square to its pinned corner, and back', () => {
    const next = random(9);
    for (let trial = 0; trial < 50; trial += 1) {
      // A convex quad: each corner jittered inside its own quarter.
      const jitter = (): number => next() * 0.35;
      const bl: Vec2 = [jitter(), jitter()];
      const br: Vec2 = [1 - jitter(), jitter()];
      const tr: Vec2 = [1 - jitter(), 1 - jitter()];
      const tl: Vec2 = [jitter(), 1 - jitter()];
      const map = squareToQuad(bl, br, tr, tl);
      const corners: [Vec2, Vec2][] = [
        [[0, 0], bl],
        [[1, 0], br],
        [[1, 1], tr],
        [[0, 1], tl],
      ];
      for (const [square, quad] of corners) {
        const [x, y] = applyHomography(map, square);
        expect(x).toBeCloseTo(quad[0], 9);
        expect(y).toBeCloseTo(quad[1], 9);
      }
      const p: Vec2 = [next(), next()];
      const [u, v] = quadToSquare(map, applyHomography(map, p));
      expect(u).toBeCloseTo(p[0], 9);
      expect(v).toBeCloseTo(p[1], 9);
    }
  });
});
