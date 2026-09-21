/**
 * Effect definitions and the registry the whole app reads from.
 *
 * Adding an effect is meant to cost one file and one line in `registry`:
 * the "Add module" menu, the node's parameter controls, the shader program
 * cache and the frame policy all derive from the `EffectDef` alone.
 */

/** A single tweakable knob on an effect, rendered as a labeled slider. */
export type ParamSpec = {
  kind: 'float';
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

export type EffectDef = {
  id: string;
  label: string;
  /**
   * Whether the effect's output changes on its own over time. One animated
   * effect anywhere in the chain is what flips the renderer from drawing
   * on demand to running a continuous frame loop, so a graph of purely flat
   * effects costs nothing while it sits there.
   */
  animated: boolean;
  params: ParamSpec[];
  /**
   * Fragment shader body only. `prelude` supplies the version header, the
   * varying and the uniforms every effect shares; the body just has to
   * assign `fragColor`.
   */
  fragment: string;
};

/**
 * Boilerplate prepended to every effect body.
 *
 * `u_src` is the previous stage's output (the image itself for the first
 * effect), `u_resolution` is the working resolution in pixels, and `u_time`
 * is seconds since the renderer started -- the only input an animated effect
 * needs to drive itself.
 */
export const prelude = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_src;
uniform vec2 u_resolution;
uniform float u_time;
`;

/** Wrap an effect body, plus its params as uniforms, into a full shader. */
export const buildFragmentSource = (def: EffectDef): string => {
  const uniforms = def.params.map((p) => `uniform float u_${p.key};`).join('\n');
  return `${prelude}${uniforms}\n\nvoid main() {\n${def.fragment}\n}\n`;
};

/** Starting values for a freshly added node, straight off the spec. */
export const defaultParams = (def: EffectDef): Record<string, number> => {
  const params: Record<string, number> = {};
  for (const p of def.params) params[p.key] = p.default;
  return params;
};
