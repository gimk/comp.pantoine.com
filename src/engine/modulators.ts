/**
 * Modulators: nodes that move another node's knob over time.
 *
 * A modulator draws nothing. It is a function of time wired into one
 * param's port, and the renderer evaluates it every frame just before that
 * param goes to the GPU. The slider keeps its value; the modulation swings
 * around it (or above it, or below it), so taking the wire off puts the
 * knob back exactly where it was.
 *
 * The binding is the wire itself, not something stored in the param. That
 * keeps `ParamValue` a plain value -- saved documents, the Mix knob and the
 * reconciliation on load need to know nothing about modulation -- and it
 * makes a binding something you can see, move and delete like any other.
 */
import type { ParamSpec, ParamValue } from './effects';

export type ModulatorDef = {
  id: string;
  label: string;
  params: ParamSpec[];
  /**
   * The raw signal at a given moment, in -1..1. `seed` is stable per node,
   * so two random LFOs do not wander in step.
   */
  sample: (params: Record<string, ParamValue>, time: number, seed: number) => number;
  /** Whether the signal moves at these settings. A stopped LFO costs nothing. */
  moving: (params: Record<string, ParamValue>) => boolean;
};

/**
 * What every modulator gets, whatever its signal: how far it pushes and in
 * which direction. Added the way Mix is added to effects, so the rule for
 * turning a signal into a knob position is the same everywhere.
 *
 * Depth is a fraction of the target's own slider range rather than an
 * absolute amount, because one LFO can drive a knob that runs 0..1 and
 * another that runs 0..64 -- in absolute units there is no depth that
 * would suit both.
 */
const DEPTH_PARAM: ParamSpec = {
  kind: 'float',
  key: 'depth',
  label: 'Depth',
  min: 0,
  max: 1,
  step: 0.01,
  default: 0.25,
};

const POLARITY_PARAM: ParamSpec = {
  kind: 'enum',
  key: 'polarity',
  label: 'Swing',
  options: ['Around', 'Above', 'Below'],
  default: 0,
};

export const modulatorParamsOf = (def: ModulatorDef): ParamSpec[] => [
  ...def.params,
  DEPTH_PARAM,
  POLARITY_PARAM,
];

export const defaultModulatorParams = (def: ModulatorDef): Record<string, ParamValue> => {
  const params: Record<string, ParamValue> = {};
  for (const p of modulatorParamsOf(def)) params[p.key] = p.default;
  return params;
};

const num = (value: ParamValue | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const fract = (x: number): number => x - Math.floor(x);

/**
 * A stable random in 0..1 for an integer step and a seed.
 *
 * Integer mixing rather than the `fract(sin(x))` trick: this runs on the
 * CPU in float64, but the same argument applies as for the shader hashes --
 * a large step count should not start repeating or banding.
 */
const hash = (step: number, seed: number): number => {
  let h = Math.imul(Math.floor(step) | 0, 374761393) ^ Math.imul(Math.floor(seed * 1e9) | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

export const LFO_SHAPES = ['Sine', 'Triangle', 'Saw', 'Square', 'Random', 'Drift'] as const;

/**
 * The oscillator.
 *
 * Random holds a new value each cycle -- sample and hold, the stepped
 * wander of a failing tracking servo. Drift eases between the same values
 * instead, which is the slow, unsteady swim of a tape transport and
 * usually the one to reach for on anything analog.
 *
 * Rate is in hertz of wall-clock time, from the same wrapped clock the
 * shaders see, so at the wrap (every ~17 minutes) the phase jumps once.
 */
export const lfo: ModulatorDef = {
  id: 'lfo',
  label: 'LFO',
  params: [
    { kind: 'enum', key: 'shape', label: 'Shape', options: [...LFO_SHAPES], default: 0 },
    { kind: 'float', key: 'rate', label: 'Rate (Hz)', min: 0, max: 10, step: 0.01, default: 0.5 },
    { kind: 'float', key: 'phase', label: 'Phase', min: 0, max: 1, step: 0.01, default: 0 },
  ],
  sample: (params, time, seed) => {
    const x = time * num(params.rate, 0) + num(params.phase, 0);
    switch (Math.round(num(params.shape, 0))) {
      case 1:
        return 1 - 4 * Math.abs(fract(x + 0.25) - 0.5);
      case 2:
        return 2 * fract(x) - 1;
      case 3:
        return fract(x) < 0.5 ? 1 : -1;
      case 4:
        return hash(Math.floor(x), seed) * 2 - 1;
      case 5: {
        const step = Math.floor(x);
        const t = fract(x);
        const eased = t * t * (3 - 2 * t);
        const a = hash(step, seed);
        const b = hash(step + 1, seed);
        return (a + (b - a) * eased) * 2 - 1;
      }
      default:
        return Math.sin(x * Math.PI * 2);
    }
  },
  moving: (params) => num(params.rate, 0) !== 0 && num(params.depth, 0) !== 0,
};

/** Every modulator the app knows about, in menu order. */
export const modulatorRegistry: ModulatorDef[] = [lfo];

const byId = new Map(modulatorRegistry.map((def) => [def.id, def]));

export const getModulator = (id: string): ModulatorDef | undefined => byId.get(id);

/**
 * Only continuous knobs take a modulation wire. A toggle or a mode switch
 * flickering between states at an LFO's rate is never what anyone meant,
 * and a colour or a point would need a depth per channel to mean anything.
 */
export const isModulatable = (spec: ParamSpec): spec is Extract<ParamSpec, { kind: 'float' | 'int' }> =>
  spec.kind === 'float' || spec.kind === 'int';

/** One modulator wired into one param, resolved for the renderer. */
export type Modulation = {
  def: ModulatorDef;
  params: Record<string, ParamValue>;
  seed: number;
};

/**
 * Where a modulated knob actually is at `time`.
 *
 * Clamped to the slider's own range: effects are written assuming their
 * params stay inside the limits their specs declare, and an LFO is not a
 * reason to hand one a negative radius.
 */
export const modulatedValue = (
  spec: ParamSpec,
  base: ParamValue | undefined,
  modulation: Modulation,
  time: number,
): ParamValue => {
  if (!isModulatable(spec)) return base ?? spec.default;
  const value = num(base, spec.default);
  const depth = num(modulation.params.depth, 0);
  if (depth === 0) return value;

  const signal = modulation.def.sample(modulation.params, time, modulation.seed);
  const span = (spec.max - spec.min) * depth;
  const polarity = Math.round(num(modulation.params.polarity, 0));
  const offset =
    polarity === 1 ? ((signal + 1) / 2) * span : polarity === 2 ? -((signal + 1) / 2) * span : (signal / 2) * span;

  return Math.min(spec.max, Math.max(spec.min, value + offset));
};
