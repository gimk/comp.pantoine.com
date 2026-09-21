import type { EffectDef } from './effects';

/**
 * Desaturation on the Rec. 709 luma weights, which track perceived
 * brightness far better than a flat average of the channels -- a pure red
 * and a pure green come out as clearly different greys rather than the same
 * muddy one.
 *
 * `amount` mixes rather than switches so the effect can be dialed in, and so
 * the node proves that live parameter updates reach the shader.
 */
export const blackwhite: EffectDef = {
  id: 'blackwhite',
  label: 'Black & White',
  animated: false,
  params: [
    { kind: 'float', key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float luma = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
  fragColor = vec4(mix(src.rgb, vec3(luma), u_amount), src.a);`,
};
