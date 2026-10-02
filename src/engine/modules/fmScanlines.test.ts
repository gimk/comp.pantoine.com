import { describe, expect, it } from 'vitest';
import { getEffect } from '../registry';
import { passesOf } from '../effects';
import { fmPhase, fmScanlines } from './fmScanlines';

describe('Frequency Modulation', () => {
  it('is registered as a float-scratch, four-pass effect', () => {
    expect(getEffect('fmScanlines')).toBe(fmScanlines);
    expect(fmScanlines.scratch).toBe('float');
    expect(passesOf(fmScanlines)).toHaveLength(4);
  });

  it('draws Carrier lines across a black row', () => {
    const phases = fmPhase(new Array(100).fill(0), 35, 90);
    expect(phases[99] + 0.5 * (35 / 100)).toBeCloseTo(35);
  });

  it('packs Depth more lines into a white row', () => {
    const phases = fmPhase(new Array(100).fill(1), 35, 90);
    expect(phases[99] + 0.5 * (125 / 100)).toBeCloseTo(125);
  });

  /*
   * The point of FM over PM: phase is an integral, so a bright band leaves
   * the rest of the row shifted after it has gone dark again. Phase
   * modulation would put the lines straight back on the carrier's grid.
   */
  it('keeps the shift a bright band left behind, after the row goes dark', () => {
    const dark = new Array(200).fill(0);
    const banded = dark.map((_, x) => (x >= 50 && x < 60 ? 1 : 0));
    const plain = fmPhase(dark, 35, 90);
    const fm = fmPhase(banded, 35, 90);

    // Identical before the band...
    expect(fm[40]).toBeCloseTo(plain[40]);
    // ...and offset by depth * (band width / row length) everywhere after it.
    const shift = 90 * (10 / 200);
    expect(fm[100] - plain[100]).toBeCloseTo(shift);
    expect(fm[199] - plain[199]).toBeCloseTo(shift);
  });
});
