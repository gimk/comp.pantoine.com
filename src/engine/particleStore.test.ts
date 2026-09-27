import { describe, expect, it } from 'vitest';
import { DRIVERS, ParticleSimulation, SIM_PREROLL_SECONDS, computeDriverGrid } from './particleStore';
import { particleFlow } from './modules/particleFlow';

/** A 1×1 "picture" of one colour, as readPixels would hand it over. */
const pixel = (r: number, g: number, b: number): Uint8Array => new Uint8Array([r, g, b, 255]);
const drive = (driver: number, rgba: Uint8Array, size = 1): Float32Array => computeDriverGrid(rgba, size, driver);

describe('particle speed drivers', () => {
  it('has one driver per menu entry, in menu order', () => {
    const menu = particleFlow.params.find((p) => p.key === 'driver');
    expect(menu?.kind).toBe('enum');
    const options = menu?.kind === 'enum' ? menu.options : [];
    expect(options.length).toBe(DRIVERS.length);
    expect(options.map((o) => o.toLowerCase().replace(/\s+/g, ''))).toEqual([
      'luminance',
      'invertedluma',
      'saturation',
      'edges',
      'red',
      'green',
      'blue',
      'hue',
    ]);
  });

  it('computes each driver from the colour', () => {
    const orange = pixel(255, 128, 0);
    expect(drive(0, orange)[0]).toBeCloseTo((0.299 * 255 + 0.587 * 128) / 255, 5);
    expect(drive(1, orange)[0]).toBeCloseTo(1 - (0.299 * 255 + 0.587 * 128) / 255, 5);
    expect(drive(2, orange)[0]).toBeCloseTo(1, 5);
    expect(drive(4, orange)[0]).toBeCloseTo(1, 5);
    expect(drive(5, orange)[0]).toBeCloseTo(128 / 255, 5);
    expect(drive(6, orange)[0]).toBeCloseTo(0, 5);
    // Orange sits about 30 degrees round the wheel.
    expect(drive(7, orange)[0]).toBeCloseTo(30.1 / 360, 2);
    expect(drive(7, pixel(128, 128, 128))[0]).toBe(0);
  });

  it('finds edges, and nothing in a flat field', () => {
    const size = 8;
    const rgba = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = x < size / 2 ? 0 : 255;
        rgba.set([v, v, v, 255], (y * size + x) * 4);
      }
    }
    const grid = drive(3, rgba, size);
    expect(grid[3 * size + 0]).toBe(0);
    expect(grid[3 * size + 3]).toBeGreaterThan(0.9);
    expect(grid[3 * size + 7]).toBe(0);
  });
});

describe('ParticleSimulation', () => {
  const run = (seed: number, times: number[]): Float32Array => {
    const sim = new ParticleSimulation(seed);
    sim.setParams({ quantity: 500, emitter: 3 });
    for (const t of times) sim.advanceTo(t);
    return sim.data.slice(0, 500 * 4);
  };

  it('is a function of seed and the times it was shown', () => {
    const times = [0, 1 / 30, 2 / 30, 3 / 30, 0.5, 1.5];
    expect(run(0.25, times)).toEqual(run(0.25, times));
    expect(run(0.25, times)).not.toEqual(run(0.75, times));
  });

  it('does not move on a redraw at the same moment', () => {
    const sim = new ParticleSimulation(0.5);
    sim.setParams({ quantity: 500 });
    sim.advanceTo(1);
    const version = sim.version;
    expect(sim.advanceTo(1)).toEqual({ advanced: 0, restarted: false });
    expect(sim.version).toBe(version);
  });

  it('starts again when time goes backwards', () => {
    const sim = new ParticleSimulation(0.5);
    sim.setParams({ quantity: 500 });
    sim.advanceTo(2);
    expect(sim.advanceTo(1).restarted).toBe(true);
    expect(sim.time).toBe(1);
  });

  it('bounds the pre-roll for a far jump', () => {
    const sim = new ParticleSimulation(0.5);
    sim.setParams({ quantity: 500 });
    const { advanced, restarted } = sim.advanceTo(500);
    expect(restarted).toBe(true);
    expect(advanced).toBeCloseTo(SIM_PREROLL_SECONDS, 9);
  });
});
