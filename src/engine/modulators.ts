/**
 * Modulators: nodes that drive another node's knob over time.
 *
 * A modulator draws nothing. It is a function of time wired into a param's
 * port, and the renderer evaluates it every frame just before that param
 * goes to the GPU.
 *
 * The model is the one compositing tools use -- Blender's nodes,
 * TouchDesigner's CHOPs, an After Effects expression. Signals are plain
 * numbers in the units of wherever they end up: an LFO swings -1..1, and if
 * that is meant to be 200..400 scanlines, a Map Range says so. A wired
 * param takes the incoming value outright, as a connected socket does; its
 * slider is locked while the wire is in and shows the value arriving.
 *
 * The binding is the wire itself, not something stored in the param. That
 * keeps `ParamValue` a plain value -- saved documents and the
 * reconciliation on load need to know nothing about modulation -- and it
 * makes a binding something you can see, move and delete like any other.
 *
 * There are two kinds of modulator. Sources make a signal from nothing but
 * the clock and sit in the Input menu beside the image. Operators combine
 * signals and sit with the modules. Every number on a modulator has a port,
 * so anything can drive anything: a Noise into an LFO's rate, an LFO into a
 * Map Range's output bounds.
 */
import type { ParamSpec, ParamValue } from './effects';

export type ModulatorDef = {
  id: string;
  label: string;
  /** Sources go in the Input menu, operators in the Module menu. */
  role: 'source' | 'operator';
  params: ParamSpec[];
  /**
   * The output at a given moment. `params` arrive with any wired ports
   * already substituted, so a node never needs to know which of its inputs
   * are connected. `seed` is stable per node, so two random sources do not
   * wander in step.
   */
  sample: (params: Record<string, ParamValue>, time: number, seed: number) => number;
  /**
   * Whether the output moves on its own at these settings. A stopped LFO
   * costs nothing; an operator moves only when something feeding it does,
   * which the renderer works out from the wiring.
   */
  moving: (params: Record<string, ParamValue>) => boolean;
  /**
   * The lowest and highest the output can ever be, or null if that cannot
   * be known. `ranges` gives each numeric param as an interval -- a point
   * for a typed value, the feeding signal's own range for a wired one, or
   * null where that is unknown. `params` carries the rest (modes, toggles).
   */
  bounds: (ranges: Record<string, Interval | null>, params: Record<string, ParamValue>) => Interval | null;
  /**
   * Params the node works out for itself from what is wired in, overriding
   * what is typed -- Map Range taking its From range from its input. Only
   * applied to params with no wire of their own.
   */
  derive?: (params: Record<string, ParamValue>, inputs: Record<string, Interval | null>) => Record<string, number>;
};

/** A closed range of numbers, low end first. */
export type Interval = [number, number];

/** The interval spanning a set of candidate values. */
const span = (...values: number[]): Interval => [Math.min(...values), Math.max(...values)];

/** A source's wave, known to lie in `wave`, through Amplitude and Offset. */
const scaledBounds = (wave: Interval, ranges: Record<string, Interval | null>): Interval | null => {
  const amp = ranges.amplitude;
  const off = ranges.offset;
  if (!amp || !off) return null;
  // Every product of the two ranges' ends; the extremes are among them.
  const [lo, hi] = span(wave[0] * amp[0], wave[0] * amp[1], wave[1] * amp[0], wave[1] * amp[1]);
  return [lo + off[0], hi + off[1]];
};

/**
 * A free number: typed rather than dragged, because its useful range
 * depends entirely on where the signal is going -- 0.1 for a darkness, 800
 * for a line count -- and no slider spans both.
 */
const field = (key: string, label: string, value: number, step = 0.01): ParamSpec => ({
  kind: 'float',
  key,
  label,
  min: -1e6,
  max: 1e6,
  step,
  default: value,
  field: true,
});

/** Scale and shift for a source's raw wave, as on a TouchDesigner LFO. */
const AMPLITUDE_OFFSET: ParamSpec[] = [field('amplitude', 'Amplitude', 1), field('offset', 'Offset', 0)];

export const modulatorParamsOf = (def: ModulatorDef): ParamSpec[] => def.params;

/**
 * Only continuous knobs take a signal wire. A toggle or a mode switch
 * flickering between states at an LFO's rate is never what anyone meant,
 * and a colour or a point would need a signal per channel to mean anything.
 */
export const isModulatable = (spec: ParamSpec): spec is Extract<ParamSpec, { kind: 'float' | 'int' }> =>
  spec.kind === 'float' || spec.kind === 'int';

/** Every number on a modulator takes a wire, as every socket does in a node editor. */
export const modulatorPortsOf = (def: ModulatorDef): string[] =>
  def.params.filter(isModulatable).map((spec) => spec.key);

export const defaultModulatorParams = (def: ModulatorDef): Record<string, ParamValue> => {
  const params: Record<string, ParamValue> = {};
  for (const p of def.params) params[p.key] = p.default;
  return params;
};

const num = (value: ParamValue | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const fract = (x: number): number => x - Math.floor(x);
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const smooth = (t: number): number => t * t * (3 - 2 * t);

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

/** Smoothed 1D value noise in -1..1, eased between hashed integer points. */
const valueNoise = (x: number, seed: number): number => {
  const step = Math.floor(x);
  const a = hash(step, seed);
  const b = hash(step + 1, seed);
  return (a + (b - a) * smooth(fract(x))) * 2 - 1;
};

/** Apply a source's Amplitude and Offset to its raw wave. */
const scaled = (params: Record<string, ParamValue>, wave: number): number =>
  wave * num(params.amplitude, 1) + num(params.offset, 0);

const sourceMoving = (params: Record<string, ParamValue>): boolean =>
  num(params.rate, 0) !== 0 && num(params.amplitude, 1) !== 0;

export const LFO_SHAPES = ['Sine', 'Triangle', 'Saw', 'Square', 'Random', 'Drift'] as const;

/**
 * The oscillator: a -1..1 wave, times Amplitude, plus Offset.
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
  role: 'source',
  params: [
    { kind: 'enum', key: 'shape', label: 'Shape', options: [...LFO_SHAPES], default: 0 },
    { kind: 'float', key: 'rate', label: 'Rate (Hz)', min: 0, max: 10, step: 0.01, default: 0.5 },
    { kind: 'float', key: 'phase', label: 'Phase', min: 0, max: 1, step: 0.01, default: 0 },
    ...AMPLITUDE_OFFSET,
  ],
  sample: (params, time, seed) => {
    const x = time * num(params.rate, 0) + num(params.phase, 0);
    let wave: number;
    switch (Math.round(num(params.shape, 0))) {
      case 1:
        wave = 1 - 4 * Math.abs(fract(x + 0.25) - 0.5);
        break;
      case 2:
        wave = 2 * fract(x) - 1;
        break;
      case 3:
        wave = fract(x) < 0.5 ? 1 : -1;
        break;
      case 4:
        wave = hash(Math.floor(x), seed) * 2 - 1;
        break;
      case 5:
        wave = valueNoise(x, seed);
        break;
      default:
        wave = Math.sin(x * Math.PI * 2);
    }
    return scaled(params, wave);
  },
  moving: sourceMoving,
  bounds: (ranges) => scaledBounds([-1, 1], ranges),
};

/**
 * Wander with detail, -1..1: several octaves of the Drift curve stacked,
 * each twice as fast and half as strong as the last. One octave is a slow
 * swim; four is the nervous, never-quite-repeating jitter of a worn
 * mechanism.
 */
export const noise: ModulatorDef = {
  id: 'noise',
  label: 'Noise',
  role: 'source',
  params: [
    { kind: 'float', key: 'rate', label: 'Rate (Hz)', min: 0, max: 10, step: 0.01, default: 0.5 },
    { kind: 'int', key: 'octaves', label: 'Octaves', min: 1, max: 6, default: 3 },
    ...AMPLITUDE_OFFSET,
  ],
  sample: (params, time, seed) => {
    const octaves = clamp(Math.round(num(params.octaves, 1)), 1, 6);
    let x = time * num(params.rate, 0);
    let sum = 0;
    let amp = 1;
    let total = 0;
    for (let i = 0; i < octaves; i += 1) {
      // Each octave on its own seed, or they would all share turning points.
      sum += amp * valueNoise(x, seed + i * 0.1373);
      total += amp;
      x *= 2.02;
      amp *= 0.5;
    }
    return scaled(params, sum / total);
  },
  moving: sourceMoving,
  bounds: (ranges) => scaledBounds([-1, 1], ranges),
};

/**
 * A gate, 0 or 1: on for part of each beat, off for the rest.
 *
 * Chance is the probability any one beat fires, so below 1 it stops being
 * a metronome and becomes flicker -- a lamp on a bad circuit, frames
 * dropping out. Softness ramps the edges instead of switching, as a
 * fraction of the beat, capped at half the width so a soft pulse still
 * reaches the top.
 */
export const pulse: ModulatorDef = {
  id: 'pulse',
  label: 'Pulse',
  role: 'source',
  params: [
    { kind: 'float', key: 'rate', label: 'Rate (Hz)', min: 0, max: 20, step: 0.01, default: 2 },
    { kind: 'float', key: 'width', label: 'Width', min: 0, max: 1, step: 0.01, default: 0.5 },
    { kind: 'float', key: 'chance', label: 'Chance', min: 0, max: 1, step: 0.01, default: 1 },
    { kind: 'float', key: 'softness', label: 'Softness', min: 0, max: 0.5, step: 0.01, default: 0 },
    ...AMPLITUDE_OFFSET,
  ],
  sample: (params, time, seed) => {
    const x = time * num(params.rate, 0);
    const t = fract(x);
    const width = clamp(num(params.width, 0.5), 0, 1);
    // A beat that does not fire stays low for its whole length.
    const chance = num(params.chance, 1);
    if (chance < 1 && hash(Math.floor(x), seed) >= chance) return scaled(params, 0);
    const soft = Math.min(num(params.softness, 0), width / 2);
    const gate = soft > 0 ? clamp(Math.min(t / soft, (width - t) / soft), 0, 1) : t < width ? 1 : 0;
    return scaled(params, gate);
  },
  moving: sourceMoving,
  bounds: (ranges) => scaledBounds([0, 1], ranges),
};

/** A number, standing still -- for driving several knobs from one place. */
export const value: ModulatorDef = {
  id: 'value',
  label: 'Value',
  role: 'source',
  params: [field('value', 'Value', 1)],
  sample: (params) => num(params.value, 0),
  moving: () => false,
  bounds: (ranges) => ranges.value,
};

export const MATH_OPS = [
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Minimum',
  'Maximum',
  'Power',
  'Modulo',
  'Absolute',
  'Round',
] as const;

/**
 * Blender's Math node, trimmed to what a modulation chain reaches for.
 * Absolute and Round read A only.
 *
 * Division by zero and a negative number to a fractional power return 0
 * rather than Infinity or NaN: a param that received either would hand
 * the shader garbage, and a flat zero is the easier thing to diagnose.
 */
export const math: ModulatorDef = {
  id: 'math',
  label: 'Math',
  role: 'operator',
  params: [
    { kind: 'enum', key: 'op', label: 'Operation', options: [...MATH_OPS], default: 0 },
    field('a', 'A', 0),
    field('b', 'B', 0),
  ],
  sample: (params) => {
    const a = num(params.a, 0);
    const b = num(params.b, 0);
    let out: number;
    switch (Math.round(num(params.op, 0))) {
      case 1:
        out = a - b;
        break;
      case 2:
        out = a * b;
        break;
      case 3:
        out = b === 0 ? 0 : a / b;
        break;
      case 4:
        out = Math.min(a, b);
        break;
      case 5:
        out = Math.max(a, b);
        break;
      case 6:
        out = Math.pow(a, b);
        break;
      case 7:
        // Floored, so the result takes B's sign -- a Modulo of a falling
        // signal keeps sawing the same way instead of flipping below zero.
        out = b === 0 ? 0 : a - b * Math.floor(a / b);
        break;
      case 8:
        out = Math.abs(a);
        break;
      case 9:
        out = Math.round(a);
        break;
      default:
        out = a + b;
    }
    return Number.isFinite(out) ? out : 0;
  },
  moving: () => false,
  /*
   * Interval arithmetic: the output range from the input ranges, exact for
   * everything but Power and Modulo, where it is only claimed when the
   * shape of the function makes the ends easy to find.
   */
  bounds: (ranges, params) => {
    const a = ranges.a;
    const b = ranges.b;
    const op = Math.round(num(params.op, 0));
    if (!a) return null;
    if (op === 8) return a[0] >= 0 ? a : a[1] <= 0 ? [-a[1], -a[0]] : [0, Math.max(-a[0], a[1])];
    if (op === 9) return [Math.round(a[0]), Math.round(a[1])];
    if (!b) return null;
    switch (op) {
      case 1:
        return [a[0] - b[1], a[1] - b[0]];
      case 2:
        return span(a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]);
      case 3:
        // Across zero the quotient is unbounded.
        if (b[0] <= 0 && b[1] >= 0) return null;
        return span(a[0] / b[0], a[0] / b[1], a[1] / b[0], a[1] / b[1]);
      case 4:
        return [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
      case 5:
        return [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      case 6:
        // With a non-negative base, a^b is monotonic in each argument, so
        // the extremes sit at the corners.
        if (a[0] < 0) return null;
        return span(a[0] ** b[0], a[0] ** b[1], a[1] ** b[0], a[1] ** b[1]);
      case 7:
        if (b[0] > 0) return [0, b[1]];
        if (b[1] < 0) return [b[0], 0];
        return null;
      default:
        return [a[0] + b[0], a[1] + b[1]];
    }
  },
};

export const MAP_INTERPOLATIONS = ['Linear', 'Stepped', 'Smooth'] as const;

/**
 * Blender's Map Range: take a value from one range to another.
 *
 * The node that turns a signal into a knob's units -- an LFO's -1..1 into
 * 200..400 lines. The output always stays inside the To range: that is
 * what the node is asked for, so there is no Clamp toggle to forget. With
 * Auto range on, the From range is the input's own, and nothing has to be
 * typed but where it should land.
 *
 * Stepped quantizes the way across into Steps + 1 levels; Smooth eases it
 * with an S-curve, so a triangle lingers at its ends like a sine.
 */
export const mapRange: ModulatorDef = {
  id: 'map',
  label: 'Map Range',
  role: 'operator',
  params: [
    { kind: 'enum', key: 'interpolation', label: 'Interpolation', options: [...MAP_INTERPOLATIONS], default: 0 },
    field('x', 'Value', 0),
    { kind: 'bool', key: 'auto', label: 'Auto range', default: true },
    field('fromMin', 'From Min', -1),
    field('fromMax', 'From Max', 1),
    field('toMin', 'To Min', 0),
    field('toMax', 'To Max', 1),
    { kind: 'int', key: 'steps', label: 'Steps', min: 1, max: 32, default: 4 },
  ],
  sample: (params) => {
    const fromMin = num(params.fromMin, -1);
    const fromMax = num(params.fromMax, 1);
    const width = fromMax - fromMin;
    let t = clamp(width === 0 ? 0 : (num(params.x, 0) - fromMin) / width, 0, 1);
    const interpolation = Math.round(num(params.interpolation, 0));
    if (interpolation === 1) {
      // Blender's stepping: Steps + 1 levels, bottom of the range to top.
      const steps = Math.max(1, Math.round(num(params.steps, 4)));
      t = Math.min(1, Math.floor(t * (steps + 1)) / steps);
    } else if (interpolation === 2) {
      t = smooth(t);
    }
    const toMin = num(params.toMin, 0);
    return toMin + (num(params.toMax, 1) - toMin) * t;
  },
  moving: () => false,
  // Whatever comes in, the output cannot leave the To range.
  bounds: (ranges) => {
    const { toMin, toMax } = ranges;
    return toMin && toMax ? span(toMin[0], toMin[1], toMax[0], toMax[1]) : null;
  },
  /*
   * Auto range: the From range is whatever the input can reach, so an LFO
   * wired straight in maps its full swing onto the To range with nothing
   * typed. Left alone when the input's range is unknown or a single point,
   * which would make the mapping divide by nothing.
   */
  derive: (params, inputs): Record<string, number> => {
    const x = inputs.x;
    if (params.auto === false || !x || !(x[1] > x[0])) return {};
    return { fromMin: x[0], fromMax: x[1] };
  },
};

/** Every modulator the app knows about, in menu order within its role. */
export const modulatorRegistry: ModulatorDef[] = [lfo, noise, pulse, value, math, mapRange];

const byId = new Map(modulatorRegistry.map((def) => [def.id, def]));

export const getModulator = (id: string): ModulatorDef | undefined => byId.get(id);

/**
 * One modulator, resolved for the renderer: its settings, and whatever is
 * wired into its own ports, as a tree.
 */
export type Signal = {
  def: ModulatorDef;
  params: Record<string, ParamValue>;
  seed: number;
  inputs: Record<string, Signal>;
};

/**
 * The value a wired param takes at `time`: the signal, as it arrives.
 *
 * `range` clamps it to the param's declared limits. An effect's params
 * get that -- shaders are written assuming their knobs stay inside the
 * range their specs declare, and a signal is not a reason to hand one a
 * negative radius. A modulator's free fields do not need it.
 *
 * The one place this is decided, so the renderer and the number shown on
 * the card cannot come to different answers.
 */
export const readPort = (
  spec: Extract<ParamSpec, { kind: 'float' | 'int' }>,
  signal: Signal,
  time: number,
  range: boolean,
): number => {
  const value = evaluateSignal(signal, time);
  return range ? clamp(value, spec.min, spec.max) : value;
};

/**
 * The params a node works out for itself from its inputs' ranges, minus
 * any that have a wire of their own -- a wire always wins.
 */
export const derivedParams = (signal: Signal): Record<string, number> => {
  const { def, inputs } = signal;
  if (!def.derive) return {};
  const ranges: Record<string, Interval | null> = {};
  for (const [key, input] of Object.entries(inputs)) ranges[key] = signalBounds(input);
  const derived = def.derive(signal.params, ranges);
  for (const key of Object.keys(derived)) if (inputs[key]) delete derived[key];
  return derived;
};

/** A node's params at `time`, with wired ports substituted and derived ones worked out. */
const effectiveParams = (signal: Signal, time: number): Record<string, ParamValue> => {
  const { def, inputs } = signal;
  if (Object.keys(inputs).length === 0) return signal.params;
  const params: Record<string, ParamValue> = { ...signal.params, ...derivedParams(signal) };
  for (const spec of def.params) {
    const input = inputs[spec.key];
    if (!input || !isModulatable(spec)) continue;
    params[spec.key] = readPort(spec, input, time, !(spec.kind === 'float' && spec.field));
  }
  return params;
};

/**
 * Cached per resolved signal. Signals are rebuilt whenever the graph
 * changes, so an entry never outlives the wiring it describes, and a
 * range asked for every frame is worked out once.
 */
const boundsCache = new WeakMap<Signal, Interval | null>();

/**
 * The lowest and highest a signal can ever be, or null if that cannot be
 * known. Worked out from the settings and the wiring, not by watching the
 * output -- a random source's range is its range whether or not it has
 * got round to the extremes yet.
 */
export const signalBounds = (signal: Signal): Interval | null => {
  const cached = boundsCache.get(signal);
  if (cached !== undefined) return cached;
  const { def, inputs } = signal;
  const params: Record<string, ParamValue> = { ...signal.params, ...derivedParams(signal) };
  const ranges: Record<string, Interval | null> = {};
  for (const spec of def.params) {
    if (!isModulatable(spec)) continue;
    const input = inputs[spec.key];
    if (input) {
      const range = signalBounds(input);
      // A slider clamps what arrives, so its range narrows to fit; a free
      // field takes whatever comes.
      const free = spec.kind === 'float' && spec.field;
      ranges[spec.key] =
        range && !free ? [clamp(range[0], spec.min, spec.max), clamp(range[1], spec.min, spec.max)] : range;
    } else {
      const v = num(params[spec.key], spec.default);
      ranges[spec.key] = [v, v];
    }
  }
  const bounds = def.bounds(ranges, params);
  const result = bounds && Number.isFinite(bounds[0]) && Number.isFinite(bounds[1]) ? bounds : null;
  boundsCache.set(signal, result);
  return result;
};

/** A signal's value at `time`. */
export const evaluateSignal = (signal: Signal, time: number): number => {
  const out = signal.def.sample(effectiveParams(signal, time), time, signal.seed);
  return Number.isFinite(out) ? out : 0;
};

/**
 * Whether a signal can change without anyone touching a knob.
 *
 * Asked of the params as they arrive, wires included -- an LFO with its
 * Amplitude field at zero but a Value wired into that port is very much
 * moving. If nothing feeding it moves, those params are the same at every
 * moment, so reading them at time zero is exact.
 */
export const signalIsMoving = (signal: Signal): boolean =>
  Object.values(signal.inputs).some(signalIsMoving) || signal.def.moving(effectiveParams(signal, 0));

/** Everything a signal's value depends on, for deciding when to redraw. */
export const signalKey = (signal: Signal): unknown => [
  signal.def.id,
  signal.params,
  signal.seed,
  Object.entries(signal.inputs).map(([key, input]) => [key, signalKey(input)]),
];

/**
 * The value a param is drawn with at `time`: the signal if one is wired,
 * clamped to the param's range; otherwise the value it is set to.
 */
export const modulatedValue = (
  spec: ParamSpec,
  base: ParamValue | undefined,
  signal: Signal,
  time: number,
): ParamValue => {
  if (!isModulatable(spec)) return base ?? spec.default;
  return readPort(spec, signal, time, true);
};
