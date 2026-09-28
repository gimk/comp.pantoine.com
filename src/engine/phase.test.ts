import { describe, expect, it } from 'vitest';
import { PHASE_WRAP, PhaseCarry, PhaseIntegrator, constantPhase, wrapPhase } from './phase';

describe('phase', () => {
  it('is exact for a constant rate, and wraps into [0, PHASE_WRAP)', () => {
    expect(constantPhase(2.5, 2)).toBe(5);
    expect(constantPhase(600, 2)).toBeCloseTo(200, 9);
    expect(constantPhase(1, -3)).toBe(PHASE_WRAP - 3);
    expect(wrapPhase(-0.25, 1)).toBe(0.75);
  });

  it('integrates a varying rate', () => {
    const phases = new PhaseIntegrator();
    // ∫ 2t dt from 0 to 3 = 9, and the midpoint rule is exact for it.
    expect(phases.integrate('k', 3, 'a', (t) => 2 * t)).toBeCloseTo(9, 9);
    // ∫ (1 + sin t) dt from 0 to 10 = 10 + 1 - cos 10
    expect(phases.integrate('s', 10, 'a', (t) => 1 + Math.sin(t))).toBeCloseTo(11 - Math.cos(10), 4);
  });

  it('gives the same answer however the time was reached', () => {
    const rate = (t: number) => 1 + 0.5 * Math.sin(3 * t);
    const live = new PhaseIntegrator();
    let played = 0;
    for (let f = 0; f <= 300; f += 1) played = live.integrate('k', f / 60, 'a', rate);
    const seeked = new PhaseIntegrator().integrate('k', 300 / 60, 'a', rate);
    expect(played).toBeCloseTo(seeked, 9);
  });

  it('recomputes on a seek backwards or a change of identity', () => {
    const phases = new PhaseIntegrator();
    phases.integrate('k', 4, 'a', () => 1);
    expect(phases.integrate('k', 2, 'a', () => 1)).toBeCloseTo(2, 9);
    expect(phases.integrate('k', 2, 'b', () => 3)).toBeCloseTo(6, 9);
  });

  it('can integrate without wrapping', () => {
    const phases = new PhaseIntegrator();
    expect(phases.integrate('k', 600, 'a', () => 4, Infinity)).toBeCloseTo(2400, 6);
  });

  it('carries a phase on from where it was when the rate changes', () => {
    const carry = new PhaseCarry();
    // 300 s in at 0.06: phase 18. Nudging to 0.065 must not jump to 19.5.
    expect(carry.carry('k', 300, 'rate:0.06', constantPhase(300, 0.06))).toBeCloseTo(18, 9);
    expect(carry.carry('k', 300, 'rate:0.065', constantPhase(300, 0.065))).toBeCloseTo(18, 9);
    // ...and carries on from there at the new rate.
    expect(carry.carry('k', 302, 'rate:0.065', constantPhase(302, 0.065))).toBeCloseTo(18.13, 9);
  });

  it('holds still while paused, however the rate is dragged', () => {
    const carry = new PhaseCarry();
    carry.carry('k', 120, 'rate:0.5', constantPhase(120, 0.5));
    for (const rate of [0.6, 0.9, -0.3, 1]) {
      expect(carry.carry('k', 120, 'rate:' + rate, constantPhase(120, rate))).toBeCloseTo(60, 9);
    }
  });

  it('goes back to the pure function of time on a seek or reset', () => {
    const carry = new PhaseCarry();
    carry.carry('k', 300, 'rate:0.06', constantPhase(300, 0.06));
    carry.carry('k', 300, 'rate:0.1', constantPhase(300, 0.1));
    // Back to 10 s: exactly what an export starting fresh would draw.
    expect(carry.carry('k', 10, 'rate:0.1', constantPhase(10, 0.1))).toBeCloseTo(1, 9);
  });
});
