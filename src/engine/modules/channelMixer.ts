import type { EffectDef, ParamSpec } from '../effects';

const CHANNELS = [
  ['r', 'Red'],
  ['g', 'Green'],
  ['b', 'Blue'],
] as const;

/** One output channel's three gains: how much of R, G and B goes into it. */
const row = (out: (typeof CHANNELS)[number], index: number): ParamSpec[] =>
  CHANNELS.map(([key, name], k) => ({
    kind: 'float',
    key: `${out[0]}From${key.toUpperCase()}`,
    label: `${out[1]} ← ${name[0]}`,
    min: -2,
    max: 2,
    step: 0.01,
    default: k === index ? 1 : 0,
    // Monochrome takes every channel from the Red row.
    activeWhen: index === 0 ? undefined : (params) => !params.monochrome,
  }));

/**
 * Each output channel as a weighted sum of the three inputs: swap red and
 * blue, build an infrared look from green, or -- with Monochrome -- a black
 * and white mixed from chosen channels, the way a filter in front of
 * black-and-white film would.
 *
 * Identity by default. Gains run negative as well, which is how a channel
 * is subtracted out.
 */
export const channelMixer: EffectDef = {
  id: 'channelMixer',
  label: 'Channel Mixer',
  category: 'color',
  animated: false,
  mixable: true,
  params: [
    ...CHANNELS.flatMap((out, index) => row(out, index)),
    { kind: 'bool', key: 'monochrome', label: 'Monochrome', default: false },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  vec3 c = src.rgb;
  float r = dot(c, vec3(u_rFromR, u_rFromG, u_rFromB));
  vec3 outRgb = u_monochrome
    ? vec3(r)
    : vec3(r, dot(c, vec3(u_gFromR, u_gFromG, u_gFromB)), dot(c, vec3(u_bFromR, u_bFromG, u_bFromB)));
  fragColor = vec4(sat(outRgb), src.a);`,
};
