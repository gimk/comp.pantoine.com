import type { EffectDef } from '../effects';

/**
 * Gaussian blur, separated into a horizontal and a vertical pass.
 *
 * A 2D Gaussian is the product of two 1D ones, so two 17-tap passes give
 * the same result as one 289-tap square would, at a ninth of the samples.
 *
 * Both passes run the identical body and tell themselves apart by `u_pass`
 * -- which is the whole reason that uniform exists.
 */
const AXIS = `  vec2 dir = (u_pass == 0) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  fragColor = blurAxis(u_src, v_uv, u_resolution, dir, u_radius);`;

export const blur: EffectDef = {
  id: 'blur',
  label: 'Blur',
  category: 'blur',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'radius', label: 'Radius', min: 0, max: 64, step: 0.5, default: 6 },
  ],
  fragment: [AXIS, AXIS],
};
