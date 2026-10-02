import { describe, expect, it } from 'vitest';
import { CACHE_BUDGET, cacheShape, layerOf, slotsToWrite } from './timeCache';
import { acceptsField, buildFragmentSource, paramsOf } from './effects';
import { getEffect } from './registry';

describe('time cache', () => {
  it('fills the whole ring, newest last, when empty or after time went back', () => {
    expect(slotsToWrite(null, 10, 4)).toEqual([7, 8, 9, 10]);
    expect(slotsToWrite(12, 10, 4)).toEqual([7, 8, 9, 10]);
  });

  it('writes each slot passed since the last frame, and no more than the ring', () => {
    expect(slotsToWrite(10, 10, 4)).toEqual([10]);
    expect(slotsToWrite(10, 11, 4)).toEqual([11]);
    expect(slotsToWrite(10, 13, 4)).toEqual([11, 12, 13]);
    expect(slotsToWrite(10, 100, 4)).toEqual([97, 98, 99, 100]);
  });

  it('maps any slot, negative too, to a layer of the ring', () => {
    expect(layerOf(5, 4)).toBe(1);
    expect(layerOf(-1, 4)).toBe(3);
  });

  it('keeps the frame count and shrinks the picture to fit the budget', () => {
    const small = cacheShape({ frames: 60, fps: 30, scale: 0.5 }, 1000, 500, 256);
    expect(small).toEqual({ width: 500, height: 250, layers: 60 });

    const big = cacheShape({ frames: 240, fps: 30, scale: 1 }, 3840, 2160, 256);
    expect(big.layers).toBe(240);
    expect(big.width * big.height * 4 * big.layers).toBeLessThanOrEqual(CACHE_BUDGET);
    expect(big.width / big.height).toBeCloseTo(3840 / 2160, 1);
  });

  it('holds the frame count to what the GPU allows', () => {
    expect(cacheShape({ frames: 240, fps: 30, scale: 0.25 }, 100, 100, 128).layers).toBe(128);
  });
});

describe('Time Machine module', () => {
  const def = getEffect('timeMachine')!;

  it('declares the cache sampler at global scope', () => {
    const source = buildFragmentSource(def, 0);
    const main = source.indexOf('void main()');
    expect(source.indexOf('uniform highp sampler2DArray u_cache;')).toBeGreaterThan(-1);
    expect(source.indexOf('uniform highp sampler2DArray u_cache;')).toBeLessThan(main);
  });

  it('gives cache settings a round port, and offsets a diamond one', () => {
    const byKey = new Map(paramsOf(def).map((spec) => [spec.key, spec]));
    expect(acceptsField(def, byKey.get('frames')!)).toBe(false);
    expect(acceptsField(def, byKey.get('cacheFps')!)).toBe(false);
    expect(acceptsField(def, byKey.get('whiteOffset')!)).toBe(true);
  });
});
