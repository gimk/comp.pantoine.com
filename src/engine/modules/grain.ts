import type { EffectDef } from '../effects';

/**
 * Additive film/sensor grain.
 *
 * Quantised to cells so Size is a real grain size rather than a blur of
 * per-pixel noise, and held for whole frames at Rate so the grain reads as
 * film running at a frame rate instead of boiling at the monitor's refresh.
 *
 * `u_seed` is mixed in so two grain modules in one chain -- one coarse, one
 * fine -- do not lay down the identical dirt on top of itself.
 */
export const grain: EffectDef = {
  id: 'grain',
  label: 'Grain',
  category: 'noise',
  animated: (params) => params.rate !== 0,
  mixable: true,
  params: [
    { kind: 'float', key: 'amount', label: 'Amount', min: 0, max: 0.5, step: 0.005, default: 0.08 },
    { kind: 'float', key: 'size', label: 'Size', min: 1, max: 8, step: 0.5, default: 1 },
    { kind: 'float', key: 'rate', label: 'Rate', min: 0, max: 60, step: 1, default: 24 },
    { kind: 'bool', key: 'mono', label: 'Monochrome', default: true },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  vec2 cell = floor(v_uv * u_resolution / max(u_size, 1.0));
  float tick = floor(u_time * u_rate);
  vec2 s = cell + vec2(tick * 37.0, u_seed * 991.0);
  vec3 n;
  if (u_mono) {
    n = vec3(hash12(s) - 0.5);
  } else {
    n = vec3(hash12(s), hash12(s + 11.0), hash12(s + 23.0)) - 0.5;
  }
  fragColor = vec4(src.rgb + n * u_amount, src.a);`,
};
