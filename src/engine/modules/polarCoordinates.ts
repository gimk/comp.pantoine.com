import type { EffectDef } from '../effects';

/**
 * Rectangular to polar and back: the picture's width wrapped round a
 * centre and its height run out from it, so a horizon becomes a little
 * planet and a stripe a ring -- or, the other way, a ring unrolled flat.
 *
 * The two modes are each other's inverse at the same settings, so one
 * after the other gives the picture back. Measured in square units, so a
 * ring is a circle on any frame. Edge defaults to Wrap, which is what
 * joins the seam where the angle comes back round.
 */
export const polarCoordinates: EffectDef = {
  id: 'polarCoordinates',
  label: 'Polar Coordinates',
  category: 'geometry',
  animated: false,
  mixable: true,
  params: [
    { kind: 'enum', key: 'mode', label: 'Mode', options: ['To Polar', 'To Rectangular'], default: 0 },
    { kind: 'vec2', key: 'center', label: 'Center', min: -0.5, max: 1.5, step: 0.01, default: [0.5, 0.5] },
    { kind: 'float', key: 'rotation', label: 'Rotation (°)', min: -360, max: 360, step: 1, default: 0 },
    { kind: 'float', key: 'radius', label: 'Radius', min: 0.1, max: 2, step: 0.01, default: 0.5 },
    { kind: 'enum', key: 'edge', label: 'Edge', options: ['Clamp', 'Wrap', 'Black', 'Mirror'], default: 1 },
  ],
  fragment: `  const float TAU = 6.2831853;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  float radius = max(u_radius, 0.001);
  vec2 uv;
  if (u_mode == 0) {
    // This pixel's angle picks the column, its distance the row.
    vec2 p = (v_uv - u_center) * vec2(aspect, 1.0);
    uv = vec2(atan(p.y, p.x) / TAU + 0.5 + u_rotation / 360.0, length(p) / radius);
  } else {
    // This pixel's column is an angle and its row a distance.
    float a = (v_uv.x - 0.5 - u_rotation / 360.0) * TAU;
    vec2 p = v_uv.y * radius * vec2(cos(a), sin(a));
    uv = u_center + p / vec2(aspect, 1.0);
  }
  fragColor = sampleEdge(u_src, uv, u_edge);`,
};
