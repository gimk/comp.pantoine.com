import { describe, expect, it } from 'vitest';
import {
  evaluateSignal,
  lfo,
  mapRange,
  math,
  signalBounds,
  type Signal,
} from './modulators';

describe('modulators and signal evaluation', () => {
  describe('math operator', () => {
    it('handles division by zero safely without returning NaN or Infinity', () => {
      const result = math.sample({ op: 3, a: 10, b: 0 }, 0, 0);
      expect(result).toBe(0);
      expect(Number.isFinite(result)).toBe(true);
    });

    it('computes standard arithmetic correctly', () => {
      expect(math.sample({ op: 0, a: 5, b: 3 }, 0, 0)).toBe(8); // Add
      expect(math.sample({ op: 1, a: 5, b: 3 }, 0, 0)).toBe(2); // Subtract
      expect(math.sample({ op: 2, a: 5, b: 3 }, 0, 0)).toBe(15); // Multiply
      expect(math.sample({ op: 3, a: 6, b: 3 }, 0, 0)).toBe(2); // Divide
      expect(math.sample({ op: 4, a: 5, b: 3 }, 0, 0)).toBe(3); // Min
      expect(math.sample({ op: 5, a: 5, b: 3 }, 0, 0)).toBe(5); // Max
      expect(math.sample({ op: 8, a: -4, b: 0 }, 0, 0)).toBe(4); // Absolute
      expect(math.sample({ op: 9, a: 4.6, b: 0 }, 0, 0)).toBe(5); // Round
    });

    it('safely handles fractional power of negative numbers', () => {
      const result = math.sample({ op: 6, a: -4, b: 0.5 }, 0, 0);
      expect(result).toBe(0);
      expect(Number.isFinite(result)).toBe(true);
    });
  });

  describe('mapRange operator', () => {
    it('maps values linearly from one range to another', () => {
      // 0 in [-1, 1] maps to 5 in [0, 10]
      const mapped = mapRange.sample(
        { interpolation: 0, x: 0, fromMin: -1, fromMax: 1, toMin: 0, toMax: 10 },
        0,
        0,
      );
      expect(mapped).toBeCloseTo(5, 5);
    });

    it('clamps outputs within the target range', () => {
      // 5 in [-1, 1] clamped to 1, maps to 10
      const mapped = mapRange.sample(
        { interpolation: 0, x: 5, fromMin: -1, fromMax: 1, toMin: 0, toMax: 10 },
        0,
        0,
      );
      expect(mapped).toBe(10);
    });

    it('handles zero-width fromMin and fromMax without dividing by zero', () => {
      const mapped = mapRange.sample(
        { interpolation: 0, x: 2, fromMin: 1, fromMax: 1, toMin: 0, toMax: 10 },
        0,
        0,
      );
      expect(Number.isFinite(mapped)).toBe(true);
      expect(mapped).toBe(0);
    });
  });

  describe('lfo source', () => {
    it('produces expected sine values at key phases', () => {
      // Rate 1 Hz, Amplitude 1, Offset 0:
      // at t = 0 -> sin(0) = 0
      expect(lfo.sample({ shape: 0, rate: 1, phase: 0, amplitude: 1, offset: 0 }, 0, 0)).toBeCloseTo(0, 5);
      // at t = 0.25 -> sin(pi/2) = 1
      expect(lfo.sample({ shape: 0, rate: 1, phase: 0, amplitude: 1, offset: 0 }, 0.25, 0)).toBeCloseTo(1, 5);
      // at t = 0.75 -> sin(3pi/2) = -1
      expect(lfo.sample({ shape: 0, rate: 1, phase: 0, amplitude: 1, offset: 0 }, 0.75, 0)).toBeCloseTo(-1, 5);
    });
  });

  describe('signal tree evaluation & bounds', () => {
    it('evaluates nested signals with inputs', () => {
      const lfoSignal: Signal = {
        def: lfo,
        params: { shape: 0, rate: 1, phase: 0, amplitude: 1, offset: 0 },
        seed: 0.5,
        inputs: {},
      };

      const mapSignal: Signal = {
        def: mapRange,
        params: { interpolation: 0, x: 0, auto: false, fromMin: -1, fromMax: 1, toMin: 100, toMax: 200 },
        seed: 0.1,
        inputs: { x: lfoSignal },
      };

      // at t = 0.25, lfo output is 1 -> mapped to 200
      const val = evaluateSignal(mapSignal, 0.25);
      expect(val).toBeCloseTo(200, 4);

      // bounds of mapSignal should be [100, 200]
      const bounds = signalBounds(mapSignal);
      expect(bounds).toEqual([100, 200]);
    });
  });
});
