import { describe, expect, it } from 'vitest';
import {
  effectivePlaybackRate,
  gifBudgetError,
  gifFrameDelays,
  outputSize,
  videoPosition,
  warmUpFrames,
} from './exportMath';

describe('gifFrameDelays', () => {
  it('writes whole centiseconds whose sum matches the duration', () => {
    const delays = gifFrameDelays(30, 90);
    expect(delays.every((d) => d % 10 === 0)).toBe(true);
    expect(delays.reduce((a, b) => a + b, 0)).toBe(3000);
    expect(new Set(delays)).toEqual(new Set([30, 40]));
  });

  it('keeps the running total within a centisecond at every frame', () => {
    const fps = 24;
    let total = 0;
    gifFrameDelays(fps, 240).forEach((d, i) => {
      total += d;
      expect(Math.abs(total - ((i + 1) * 1000) / fps)).toBeLessThanOrEqual(5);
    });
  });

  it('never goes under the 2cs browsers honour', () => {
    expect(Math.min(...gifFrameDelays(60, 60))).toBeGreaterThanOrEqual(20);
  });
});

describe('gifBudgetError', () => {
  it('lets a reasonable GIF through and refuses a huge one', () => {
    expect(gifBudgetError(640, 360, 90)).toBeNull();
    const message = gifBudgetError(3840, 2160, 300);
    expect(message).toMatch(/3840×2160/);
    expect(message).toMatch(/Lower the render scale/);
  });
});

describe('outputSize', () => {
  it('scales, and rounds to even for video', () => {
    expect(outputSize(4000, 3000, 0.5)).toEqual({ width: 2000, height: 1500 });
    expect(outputSize(1001, 667, 1)).toEqual({ width: 1001, height: 667 });
    expect(outputSize(1001, 667, 1, true)).toEqual({ width: 1000, height: 666 });
    expect(outputSize(1, 1, 0.1, true)).toEqual({ width: 2, height: 2 });
  });
});

describe('video timing', () => {
  it('clamps speed the way the viewer does', () => {
    expect(effectivePlaybackRate(0)).toBe(0);
    expect(effectivePlaybackRate(0.01)).toBe(0.0625);
    expect(effectivePlaybackRate(2)).toBe(2);
    expect(effectivePlaybackRate(40)).toBe(16);
  });

  it('loops or holds at the end', () => {
    expect(videoPosition(12.5, 5, true)).toBeCloseTo(2.5, 9);
    expect(videoPosition(12.5, 5, false)).toBeCloseTo(4.999, 9);
  });
});

describe('warmUpFrames', () => {
  it('never reaches before zero and is capped', () => {
    expect(warmUpFrames(0, 30, 2, 120)).toBe(0);
    expect(warmUpFrames(1, 30, 2, 120)).toBe(30);
    expect(warmUpFrames(10, 30, 2, 120)).toBe(60);
    expect(warmUpFrames(10, 120, 2, 120)).toBe(120);
  });
});
