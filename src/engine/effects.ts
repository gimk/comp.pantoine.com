/**
 * Effect definitions and the registry the whole app reads from.
 *
 * Adding an effect is meant to cost one file and one line in `registry`:
 * the "Add module" menu, the node's parameter controls, the shader program
 * cache and the frame policy all derive from the `EffectDef` alone.
 *
 * Modules are deliberately atomic -- one visible behaviour each. A CRT look
 * is a chain of eight of these rather than one node with thirty knobs, which
 * is what lets scanlines be reordered around the lens warp, and what stops
 * blur and grain being reimplemented once per look.
 */
import { STDLIB } from './stdlib';

export type Vec2 = [number, number];
/** Straight RGB, each channel 0..1 -- what the shader wants, no conversion. */
export type Rgb = [number, number, number];
export type ParamValue = number | boolean | Vec2 | Rgb;

type BaseSpec = { key: string; label: string };

/** A single tweakable knob, rendered as the control its kind implies. */
export type ParamSpec =
  | (BaseSpec & {
      kind: 'float';
      min: number;
      max: number;
      step: number;
      default: number;
      /** Typed as a number field rather than dragged on a slider. */
      field?: boolean;
    })
  | (BaseSpec & { kind: 'int'; min: number; max: number; default: number })
  | (BaseSpec & { kind: 'bool'; default: boolean })
  | (BaseSpec & { kind: 'enum'; options: string[]; default: number })
  | (BaseSpec & { kind: 'color'; default: Rgb })
  | (BaseSpec & { kind: 'vec2'; min: number; max: number; step: number; default: Vec2 });

/** How each param kind is declared in GLSL. Enums travel as their index. */
const GLSL_TYPE: Record<ParamSpec['kind'], string> = {
  float: 'float',
  int: 'int',
  bool: 'bool',
  enum: 'int',
  color: 'vec3',
  vec2: 'vec2',
};

/**
 * Menu grouping. With two dozen atomic modules a flat list is unreadable,
 * so the category is part of the definition rather than something the
 * toolbar guesses from the name.
 */
export type Category =
  | 'color'
  | 'stylize'
  | 'optics'
  | 'geometry'
  | 'crt'
  | 'tape'
  | 'noise'
  | 'temporal'
  | 'composite';

export const CATEGORY_ORDER: Category[] = [
  'color',
  'stylize',
  'optics',
  'geometry',
  'crt',
  'tape',
  'noise',
  'temporal',
  'composite',
];

export const CATEGORY_LABELS: Record<Category, string> = {
  color: 'Color & Tone',
  stylize: 'Stylize',
  optics: 'Optics & Blur',
  geometry: 'Transform & Warp',
  crt: 'CRT & Display',
  tape: 'Tape & Glitch',
  noise: 'Noise & Grain',
  temporal: 'Temporal',
  composite: 'Composite',
};

/**
 * An image input beyond the main one.
 *
 * The main input is `u_src` and every effect has it. These are the others:
 * each becomes `uniform sampler2D u_<key>`, bound from texture unit 3 up
 * (0, 1 and 2 are `u_src`, `u_orig` and `u_prev`), and gets a port of its
 * own on the card. An input with nothing wired to it samples as transparent
 * black, so an effect should treat alpha 0 as "leave the picture alone".
 */
export type InputSpec = { key: string; label: string };

/** The first texture unit free for an effect's extra inputs. */
export const FIRST_INPUT_UNIT = 3;

export type EffectDef = {
  id: string;
  label: string;
  category: Category;
  /**
   * Whether the output changes on its own over time. One animated effect
   * anywhere in the chain flips the renderer from drawing on demand to a
   * continuous frame loop, so a graph of flat effects costs nothing while
   * it sits there.
   *
   * A function rather than a flag wherever the answer depends on the knobs:
   * scanlines with the roll at zero are a still image, and should not pin a
   * frame loop for the whole session.
   */
  animated: boolean | ((params: Record<string, ParamValue>) => boolean);
  /**
   * Adds a Mix knob and crossfades the result against the input. Worth
   * having on nearly everything: eight atomic modules stacked at full
   * strength is a mess, and dialing each one back is how the stack stays
   * usable.
   */
  mixable?: boolean;
  /**
   * Binds this node's previous output as `u_prev`.
   *
   * State that survives the frame, kept per node rather than per effect --
   * two Trails nodes in one chain each keep their own history, and a node
   * that leaves the chain drops its own.
   */
  feedback?: boolean;
  params: ParamSpec[];
  /** Extra image inputs, in port order. Most effects have none. */
  inputs?: InputSpec[];
  /**
   * Fragment shader body only -- `prelude` supplies the header, the varying
   * and the shared uniforms, so the body just assigns `fragColor`.
   *
   * An array runs several passes back to back, each reading the one before,
   * which is what a separable blur needs. `u_pass` says which one is running.
   */
  fragment: string | string[];
};

/**
 * Boilerplate prepended to every effect body.
 *
 * `u_src` is the previous stage's output, `u_resolution` the working
 * resolution in pixels. `u_time` is seconds, wrapped (see clock.ts) so it
 * stays precise. `u_seed` is stable per node, so two grain modules in one
 * chain do not produce the identical dirt.
 */
export const prelude = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_src;
/** The input this effect was handed, unchanged by its own sub-passes. */
uniform sampler2D u_orig;
/** This node's own output last frame. Only bound for feedback effects. */
uniform sampler2D u_prev;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_delta;
uniform int u_frame;
uniform float u_seed;
uniform int u_pass;
`;

const MIX_PARAM: ParamSpec = {
  kind: 'float',
  key: 'mix',
  label: 'Mix',
  min: 0,
  max: 1,
  step: 0.01,
  default: 1,
};

/** The spec list including the injected Mix knob, if the effect wants one. */
export const paramsOf = (def: EffectDef): ParamSpec[] =>
  def.mixable ? [...def.params, MIX_PARAM] : def.params;

/** Effect bodies as a list, whether the definition gave one or several. */
export const passesOf = (def: EffectDef): string[] =>
  Array.isArray(def.fragment) ? def.fragment : [def.fragment];

/** Extra inputs as a list, empty for the usual single-input effect. */
export const inputsOf = (def: EffectDef): InputSpec[] => def.inputs ?? [];

export const isAnimated = (def: EffectDef, params: Record<string, ParamValue>): boolean =>
  typeof def.animated === 'function' ? def.animated(params) : def.animated;

/**
 * Keys that would collide with a uniform the prelude already declares.
 *
 * A param keyed `time` becomes `u_time`, which compiles -- as a redeclaration
 * that quietly shadows the clock for that effect only. The symptom is an
 * animated module that does not animate, with nothing in the log, so it is
 * worth refusing outright.
 */
const RESERVED_PARAM_KEYS = new Set([
  'src',
  'orig',
  'prev',
  'resolution',
  'time',
  'delta',
  'frame',
  'seed',
  'pass',
]);

/**
 * Catch what only shows up as a strange picture.
 *
 * Thrown rather than logged, because `programFor` already turns a throw here
 * into a pass-through plus a visible error on the node -- the same treatment
 * a shader that will not compile gets, which is what this is.
 */
const assertParamsAreSound = (def: EffectDef): void => {
  // Params and inputs share one namespace: both become `u_<key>`.
  const seen = new Set<string>();
  const keys = [
    ...paramsOf(def).map((spec) => ({ key: spec.key, what: 'a param' })),
    ...inputsOf(def).map((input) => ({ key: input.key, what: 'an input' })),
  ];
  for (const { key, what } of keys) {
    if (RESERVED_PARAM_KEYS.has(key)) {
      throw new Error(
        `Effect "${def.id}" has ${what} keyed "${key}", which collides with the ` +
          `built-in uniform u_${key}. Rename it.`,
      );
    }
    if (seen.has(key)) {
      throw new Error(`Effect "${def.id}" declares "${key}" twice.`);
    }
    seen.add(key);
  }
};

/**
 * Wrap one effect body, plus its params as uniforms, into a full shader.
 *
 * The Mix crossfade is applied on the last pass only -- blending a
 * multi-pass effect against the source at every intermediate step would
 * fade out the work in progress, not the result.
 */
export const buildFragmentSource = (def: EffectDef, passIndex: number): string => {
  assertParamsAreSound(def);

  const uniforms = [
    ...inputsOf(def).map((input) => `uniform sampler2D u_${input.key};`),
    ...paramsOf(def).map((p) => `uniform ${GLSL_TYPE[p.kind]} u_${p.key};`),
  ].join('\n');

  const bodies = passesOf(def);
  const isLast = passIndex === bodies.length - 1;
  const body =
    def.mixable && isLast
      ? `  vec4 mixInput = texture(u_orig, v_uv);\n${bodies[passIndex]}\n  fragColor = mix(mixInput, fragColor, u_mix);`
      : bodies[passIndex];

  return `${prelude}${STDLIB}\n${uniforms}\n\nvoid main() {\n${body}\n}\n`;
};

/** Starting values for a freshly added node, straight off the spec. */
export const defaultParams = (def: EffectDef): Record<string, ParamValue> => {
  const params: Record<string, ParamValue> = {};
  for (const p of paramsOf(def)) params[p.key] = p.default;
  return params;
};
