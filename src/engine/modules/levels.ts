import type { EffectDef } from '../effects';

/**
 * Brightness, contrast and gamma -- the module that goes at both ends of
 * most chains, to set the signal up and to claw it back afterwards.
 *
 * Contrast pivots around 0.5 rather than 0 so raising it does not also
 * brighten the picture, and gamma is applied last, on clamped values, since
 * pow() of a negative is undefined and contrast can easily push below zero.
 */
export const levels: EffectDef = {
  id: 'levels',
  label: 'Levels',
  category: 'color',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'brightness', label: 'Brightness', min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { kind: 'float', key: 'contrast', label: 'Contrast', min: 0, max: 3, step: 0.01, default: 1 },
    { kind: 'float', key: 'gamma', label: 'Gamma', min: 0.1, max: 3, step: 0.01, default: 1 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  vec3 c = (src.rgb - 0.5) * u_contrast + 0.5;
  c += u_brightness;
  c = pow(max(c, 0.0), vec3(1.0 / max(u_gamma, 0.01)));
  fragColor = vec4(c, src.a);`,
};
