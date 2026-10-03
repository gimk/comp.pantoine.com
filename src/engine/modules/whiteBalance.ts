import type { EffectDef } from '../effects';

/**
 * Temperature along blue to amber, tint along green to magenta: the two
 * axes a camera's white balance moves on.
 *
 * Applied as channel gains and then rescaled to the luma the pixel came in
 * with, so warming a picture does not also brighten it.
 */
export const whiteBalance: EffectDef = {
  id: 'whiteBalance',
  label: 'White Balance',
  category: 'color',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'temperature', label: 'Temperature', min: -1, max: 1, step: 0.01, default: 0 },
    { kind: 'float', key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01, default: 0 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  vec3 gain = vec3(1.0 + 0.3 * u_temperature + 0.15 * u_tint, 1.0 - 0.3 * u_tint, 1.0 - 0.3 * u_temperature + 0.15 * u_tint);
  vec3 c = src.rgb * max(gain, 0.0);
  float before = luma(src.rgb);
  float after = luma(c);
  if (after > 0.0001) c *= before / after;
  fragColor = vec4(c, src.a);`,
};
