import type { EffectDef } from '../effects';

/**
 * Saturation that goes easy on what is already saturated. Dull colours get
 * the most of it and vivid ones the least, so skin and sky can be livened
 * up without the reds going neon first. Negative values mute the same way.
 */
export const vibrance: EffectDef = {
  id: 'vibrance',
  label: 'Vibrance',
  category: 'color',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'vibrance', label: 'Vibrance', min: -1, max: 1, step: 0.01, default: 0 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float hi = max(src.r, max(src.g, src.b));
  float lo = min(src.r, min(src.g, src.b));
  float chroma = hi - lo;
  float amount = u_vibrance * (1.0 - sat(chroma));
  vec3 c = mix(vec3(luma(src.rgb)), src.rgb, 1.0 + amount);
  fragColor = vec4(c, src.a);`,
};
