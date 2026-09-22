import type { EffectDef } from '../effects';

/**
 * The torn, noisy band along the bottom of the frame where a helical-scan
 * deck changes heads mid-picture.
 *
 * It sits at the bottom because that is where the switch happens, and
 * `v_uv.y` is 0 there -- the bitmap is uploaded in GL orientation, so the
 * band is low values, not high.
 *
 * The displaced sample wraps rather than clamping: the real artefact slides
 * the line sideways and brings the far edge of the picture round with it,
 * where a clamp would smear one column of pixels across the tear.
 */
export const headSwitch: EffectDef = {
  id: 'headSwitch',
  label: 'Head Switch',
  category: 'scan',
  animated: (params) => params.rate !== 0,
  params: [
    { kind: 'float', key: 'height', label: 'Height', min: 0.005, max: 0.3, step: 0.005, default: 0.05 },
    { kind: 'float', key: 'amount', label: 'Shift', min: 0, max: 0.5, step: 0.005, default: 0.08 },
    { kind: 'float', key: 'noise', label: 'Noise', min: 0, max: 1, step: 0.01, default: 0.5 },
    { kind: 'float', key: 'rate', label: 'Rate', min: 0, max: 60, step: 1, default: 10 },
  ],
  fragment: `  // 1 at the very bottom, falling to 0 at the top of the band.
  float band = 1.0 - smoothstep(0.0, max(u_height, 0.001), v_uv.y);
  float tick = floor(u_time * u_rate);

  float n = valueNoise(vec2(v_uv.y * 220.0, tick + u_seed * 71.0));
  float shift = (n - 0.5) * u_amount * band;

  vec4 c = sampleEdge(u_src, vec2(v_uv.x + shift, v_uv.y), 1);
  float hiss = hash12(vec2(v_uv.x * 320.0, tick + u_seed * 13.0));
  c.rgb = mix(c.rgb, vec3(hiss), band * u_noise);

  fragColor = c;`,
};
