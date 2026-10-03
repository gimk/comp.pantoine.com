import { describe, expect, it } from 'vitest';
import type { ParamValue } from './effects';
import {
  defaultModulatorParams,
  envelope,
  evaluateSignal,
  lfo,
  modulatorPortsOf,
  pulse,
  sampleHold,
  smoothSignal,
  stepSequencer,
  stepKey,
  type ModulatorDef,
  type Signal,
} from './modulators';

const signal = (def: ModulatorDef, params: Record<string, ParamValue> = {}, inputs: Record<string, Signal> = {}): Signal => ({
  def,
  params: { ...defaultModulatorParams(def), ...params },
  seed: 0.25,
  inputs,
});

/** A gate that is on from `on` to `off` seconds: a Pulse would repeat, this does not. */
const gate = (on: number, off: number): Signal => {
  const def: ModulatorDef = {
    id: 'testGate',
    label: 'Gate',
    role: 'source',
    params: [],
    sample: (_params, time) => (time >= on && time < off ? 1 : 0),
    moving: () => true,
    bounds: () => [0, 1],
  };
  return signal(def);
};

/** The input's own clock, for checking which moment was held. */
const clock = (): Signal =>
  signal({
    id: 'testClock',
    label: 'Clock',
    role: 'source',
    params: [],
    sample: (_params, time) => time,
    moving: () => true,
    bounds: () => null,
  });

describe('Step Sequencer', () => {
  const steps = { steps: 4, rate: 2, [stepKey(0)]: 0, [stepKey(1)]: 0.3, [stepKey(2)]: 0.6, [stepKey(3)]: 1 };

  it('plays each step for its share of a second, and wraps', () => {
    const seq = signal(stepSequencer, steps);
    expect(evaluateSignal(seq, 0.25)).toBeCloseTo(0);
    expect(evaluateSignal(seq, 0.75)).toBeCloseTo(0.3);
    expect(evaluateSignal(seq, 1.25)).toBeCloseTo(0.6);
    expect(evaluateSignal(seq, 1.75)).toBeCloseTo(1);
    expect(evaluateSignal(seq, 2.25)).toBeCloseTo(0);
  });

  it('glides into the next step without jumping', () => {
    const seq = signal(stepSequencer, { ...steps, glide: 0.5 });
    let previous = evaluateSignal(seq, 0.5);
    for (let t = 0.5; t <= 1.5; t += 0.005) {
      const v = evaluateSignal(seq, t);
      expect(Math.abs(v - previous)).toBeLessThan(0.05);
      previous = v;
    }
  });

  it('takes no wires on its steps', () => {
    expect(modulatorPortsOf(stepSequencer)).not.toContain(stepKey(0));
  });
});

describe('Sample & Hold', () => {
  it('holds the input from the start of each period', () => {
    const held = signal(sampleHold, { mode: 0, rate: 4 }, { input: clock() });
    expect(evaluateSignal(held, 0.3)).toBeCloseTo(0.25);
    expect(evaluateSignal(held, 0.49)).toBeCloseTo(0.25);
    expect(evaluateSignal(held, 0.51)).toBeCloseTo(0.5);
  });

  it('takes a reading only when the trigger switches on', () => {
    const trigger = signal(pulse, { rate: 1, width: 0.5 });
    const held = signal(sampleHold, { mode: 1 }, { input: clock(), trigger });
    // Pulses rise at 0, 1, 2...: between them the value is the last rise's.
    expect(evaluateSignal(held, 0.9)).toBeCloseTo(0, 1);
    expect(evaluateSignal(held, 1.6)).toBeCloseTo(1, 1);
    expect(evaluateSignal(held, 2.4)).toBeCloseTo(2, 1);
  });
});

describe('Smooth', () => {
  it('leaves a steady input steady, and passes it through at Time 0', () => {
    const steady = signal(smoothSignal, { time: 1, input: 0.7 });
    expect(evaluateSignal(steady, 3)).toBeCloseTo(0.7);
    const sine = signal(lfo, { rate: 1 });
    const direct = signal(smoothSignal, { time: 0 }, { input: sine });
    expect(evaluateSignal(direct, 0.3)).toBeCloseTo(evaluateSignal(sine, 0.3));
  });

  it('turns a jump into a ramp', () => {
    const step = signal(smoothSignal, { time: 1 }, { input: gate(1, 100) });
    const after = [1.01, 1.25, 1.5, 2.2].map((t) => evaluateSignal(step, t));
    expect(after[0]).toBeGreaterThan(0);
    expect(after[0]).toBeLessThan(after[1]);
    expect(after[1]).toBeLessThan(after[2]);
    expect(after[3]).toBeCloseTo(1);
  });
});

describe('Envelope', () => {
  const adsr = { attack: 0.2, decay: 0.2, sustain: 0.5, release: 0.4 };

  it('rises, decays to Sustain while held, and releases after', () => {
    const env = signal(envelope, adsr, { gate: gate(1, 2) });
    expect(evaluateSignal(env, 0.5)).toBe(0);
    expect(evaluateSignal(env, 1.1)).toBeCloseTo(0.5, 1);
    expect(evaluateSignal(env, 1.2)).toBeCloseTo(1, 1);
    expect(evaluateSignal(env, 1.3)).toBeCloseTo(0.75, 1);
    expect(evaluateSignal(env, 1.8)).toBeCloseTo(0.5, 2);
    expect(evaluateSignal(env, 2.2)).toBeCloseTo(0.25, 1);
    expect(evaluateSignal(env, 2.5)).toBe(0);
  });

  it('releases from wherever the attack had got to', () => {
    const env = signal(envelope, adsr, { gate: gate(1, 1.1) });
    // Let go halfway up the attack, so at 0.5; half the release later, 0.25.
    expect(evaluateSignal(env, 1.3)).toBeCloseTo(0.25, 1);
  });
});
