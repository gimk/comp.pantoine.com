import type { EffectDef } from '../effects';

/**
 * Remap brightness onto a three-stop ramp.
 *
 * Driven by luma rather than per channel, so the result is the ramp's
 * colours and nothing of the original hue survives -- which is the point:
 * this is how a grey burn map becomes embers, and how a picture becomes a
 * duotone.
 *
 * The midpoint is exposed because the interesting stop is rarely at 0.5.
 * Embers want their hot colour crowded up near the top of the range.
 */
export const gradientMap: EffectDef = {
  id: 'gradientMap',
  label: 'Gradient Map',
  category: 'color',
  animated: false,
  mixable: true,
  params: [
    { kind: 'color', key: 'low', label: 'Shadows', default: [0.05, 0.02, 0.1] },
    { kind: 'color', key: 'mid', label: 'Midtones', default: [0.85, 0.25, 0.05] },
    { kind: 'color', key: 'high', label: 'Highlights', default: [1, 0.95, 0.7] },
    { kind: 'float', key: 'midpoint', label: 'Midpoint', min: 0.05, max: 0.95, step: 0.01, default: 0.5 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float l = luma(src.rgb);
  vec3 c = l < u_midpoint
    ? mix(u_low, u_mid, l / max(u_midpoint, 0.001))
    : mix(u_mid, u_high, (l - u_midpoint) / max(1.0 - u_midpoint, 0.001));
  fragColor = vec4(c, src.a);`,
};
