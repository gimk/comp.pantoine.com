import type { EffectDef } from '../effects';

/**
 * Mirror symmetry: a kaleidoscope of wedges, or a plain mirror across one or
 * both axes.
 *
 * The kaleidoscope folds the angle around Center into a single wedge and
 * mirrors every other one, so neighbouring wedges meet seamlessly. Rotation
 * turns the wedge pattern itself; Source Angle turns the picture under it,
 * which is what changes the content of every wedge at once.
 */
export const kaleidoscope: EffectDef = {
  id: 'kaleidoscope',
  label: 'Kaleidoscope',
  category: 'geometry',
  animated: false,
  mixable: true,
  params: [
    {
      kind: 'enum',
      key: 'mode',
      label: 'Mode',
      options: ['Kaleidoscope', 'Mirror X', 'Mirror Y', 'Mirror Quad'],
      default: 0,
    },
    {
      kind: 'int',
      key: 'segments',
      label: 'Segments',
      min: 2,
      max: 32,
      default: 6,
      activeWhen: (params) => params.mode === 0,
    },
    { kind: 'float', key: 'rotation', label: 'Rotation', min: -360, max: 360, step: 1, default: 0 },
    { kind: 'float', key: 'sourceAngle', label: 'Source Angle', min: -360, max: 360, step: 1, default: 0 },
    { kind: 'vec2', key: 'center', label: 'Center', min: -0.5, max: 1.5, step: 0.01, default: [0.5, 0.5] },
    { kind: 'float', key: 'zoom', label: 'Zoom', min: 0.1, max: 8, step: 0.01, default: 1 },
    { kind: 'enum', key: 'edge', label: 'Edge', options: ['Clamp', 'Wrap', 'Black', 'Mirror'], default: 3 },
  ],
  fragment: `  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = v_uv - u_center;
  p.x *= aspect;
  p /= max(u_zoom, 0.001);

  if (u_mode == 0) {
    float wedge = 3.14159265 / float(max(u_segments, 2));
    float a = atan(p.y, p.x) - radians(u_rotation);
    // Fold into one wedge, mirroring every other so the seams meet.
    a = abs(mod(a, 2.0 * wedge) - wedge);
    a += radians(u_rotation + u_sourceAngle);
    p = length(p) * vec2(cos(a), sin(a));
  } else {
    float c = cos(radians(u_rotation));
    float s = sin(radians(u_rotation));
    // Mirror in the rotated frame, then turn back.
    vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
    if (u_mode == 1 || u_mode == 3) q.x = abs(q.x);
    if (u_mode == 2 || u_mode == 3) q.y = abs(q.y);
    float a = radians(u_sourceAngle);
    q = vec2(cos(a) * q.x - sin(a) * q.y, sin(a) * q.x + cos(a) * q.y);
    p = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  }

  p.x /= aspect;
  fragColor = sampleEdge(u_src, p + u_center, u_edge);`,
};
