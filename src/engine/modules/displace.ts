import type { EffectDef } from '../effects';

/**
 * Warp driven by a fractal noise field -- heat haze, wet glass, the swim of
 * a tape that has been played too many times.
 *
 * The X and Y offsets are read from the same field at points far enough
 * apart to be uncorrelated. Sampling one field twice at the same spot would
 * give dx == dy and collapse every displacement onto the diagonal.
 *
 * The field carries `u_seed`, so stacking a coarse Displace and a fine one
 * warps twice rather than warping the same shape harder.
 *
 * This is the module that will later take an optional second input to use
 * as its field instead of the internal noise; the knobs are already the
 * ones that generator would expose.
 */
export const displace: EffectDef = {
  id: 'displace',
  label: 'Displace',
  category: 'geometry',
  animated: (params) => params.speed !== 0,
  params: [
    { kind: 'float', key: 'amount', label: 'Amount', min: 0, max: 0.2, step: 0.001, default: 0.02 },
    { kind: 'float', key: 'scale', label: 'Scale', min: 0.5, max: 40, step: 0.5, default: 4 },
    { kind: 'int', key: 'octaves', label: 'Octaves', min: 1, max: 8, default: 3 },
    { kind: 'float', key: 'speed', label: 'Speed', min: -2, max: 2, step: 0.01, default: 0.2 },
    { kind: 'enum', key: 'edge', label: 'Edge', options: ['Clamp', 'Wrap', 'Black', 'Mirror'], default: 0 },
  ],
  fragment: `  vec2 field = v_uv * u_scale + u_seed * 97.0;
  float t = u_time * u_speed;

  // fbm lands in roughly 0..1, so the halves are what centre the push on
  // zero -- without them the whole image would also drift bodily.
  float dx = fbm(field + vec2(t, 0.0), u_octaves) - 0.5;
  float dy = fbm(field + vec2(0.0, t) + 31.7, u_octaves) - 0.5;

  fragColor = sampleEdge(u_src, v_uv + vec2(dx, dy) * u_amount, u_edge);`,
};
