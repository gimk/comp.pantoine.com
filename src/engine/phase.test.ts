import { describe, expect, it } from 'vitest';
import { PHASE_WRAP, PhaseIntegrator, constantPhase, wrapPhase } from './phase';

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
});
