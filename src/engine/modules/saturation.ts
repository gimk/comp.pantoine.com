import type { EffectDef } from '../effects';

/**
 * Saturation and hue, as one module because they are the same operation
 * seen from two angles and are almost always reached for together.
 *
 * Hue is in turns rather than degrees or radians, so the slider reads
 * -0.5..0.5 and the ends meet where the colour wheel does.
 */
export const saturation: EffectDef = {
  id: 'saturation',
  label: 'Saturation',
  category: 'color',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, default: 1 },
    { kind: 'float', key: 'hue', label: 'Hue', min: -0.5, max: 0.5, step: 0.005, default: 0 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  vec3 c = hueRotate(src.rgb, u_hue * TAU);
  c = mix(vec3(luma(c)), c, u_saturation);
  fragColor = vec4(c, src.a);`,
};
