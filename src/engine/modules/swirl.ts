import type { EffectDef } from '../effects';

/**
 * Rotational swirl / whirlpool warp.
 *
 * Twirls pixels around an adjustable center point with quadratic falloff.
 * Aspect ratio is compensated so the swirl retains circular symmetry.
 */
export const swirl: EffectDef = {
  id: 'swirl',
  label: 'Swirl',
  category: 'geometry',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'angle', label: 'Angle', min: -720, max: 720, step: 5, default: 180 },
    { kind: 'float', key: 'radius', label: 'Radius', min: 0.05, max: 1.0, step: 0.01, default: 0.5 },
    { kind: 'vec2', key: 'center', label: 'Center', min: -0.5, max: 1.5, step: 0.01, default: [0.5, 0.5] },
    { kind: 'enum', key: 'edge', label: 'Edge', options: ['Clamp', 'Wrap', 'Black', 'Mirror'], default: 0 },
  ],
  fragment: `  vec2 p = v_uv - u_center;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  p.x *= aspect;

  float d = length(p);
  float r = max(u_radius, 0.001);

  if (d < r) {
    float percent = (r - d) / r;
    float theta = percent * percent * radians(u_angle);
    float s = sin(theta);
    float c = cos(theta);
    p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }

  p.x /= aspect;
  fragColor = sampleEdge(u_src, p + u_center, u_edge);`,
};
