import type { EffectDef } from '../effects';

/**
 * Pan, zoom and rotate.
 *
 * Unglamorous on its own, but it is what lets a chain build a ghost: two
 * branches of the same picture, one nudged a few pixels sideways, is the
 * whole trick behind a VHS echo once there is something to blend them with.
 *
 * Rotation works in a space where one unit is the same distance across and
 * down, so a square stays square on a wide image rather than shearing.
 */
export const transform: EffectDef = {
  id: 'transform',
  label: 'Transform',
  category: 'geometry',
  animated: false,
  params: [
    { kind: 'vec2', key: 'offset', label: 'Offset', min: -1, max: 1, step: 0.005, default: [0, 0] },
    { kind: 'float', key: 'scale', label: 'Scale', min: 0.1, max: 4, step: 0.01, default: 1 },
    { kind: 'float', key: 'rotation', label: 'Rotation', min: -0.5, max: 0.5, step: 0.005, default: 0 },
    { kind: 'enum', key: 'edge', label: 'Edge', options: ['Clamp', 'Wrap', 'Black', 'Mirror'], default: 0 },
  ],
  fragment: `  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (v_uv - 0.5) * vec2(aspect, 1.0);

  // Rotation in turns, so the slider ends meet where a full circle does.
  float angle = u_rotation * TAU;
  float s = sin(angle);
  float c = cos(angle);
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);

  // These transform the sample coordinate, so dividing by scale is what
  // makes the picture grow, and subtracting the offset is what moves it
  // towards the offset rather than away from it.
  p /= max(u_scale, 0.01);
  p -= u_offset * vec2(aspect, 1.0);

  fragColor = sampleEdge(u_src, p / vec2(aspect, 1.0) + 0.5, u_edge);`,
};
