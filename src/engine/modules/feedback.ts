import type { EffectDef } from '../effects';

/**
 * Video feedback: this node's last frame, moved and recoloured, mixed back
 * under the new one -- the camera pointed at its own monitor.
 *
 * Where Trails only fades the frame before, this also zooms, turns, drifts
 * and hue-shifts it on every pass, which compounds into tunnels, spirals
 * and colour cycles.
 *
 * Every motion is a rate per second applied over the frame's own delta, so
 * a tunnel spins at the same speed at 30fps as at 120. Persistence is how
 * long the echo takes to fall to a tenth, as in Trails, and it is what keeps
 * every mode bounded. There is deliberately no Add: a still picture added
 * to its own echo settles at 1/(1 - k) times itself, which at any useful
 * persistence is white within the second.
 */
export const feedback: EffectDef = {
  id: 'feedback',
  label: 'Feedback',
  category: 'temporal',
  animated: true,
  feedback: true,
  params: [
    { kind: 'float', key: 'persistence', label: 'Persistence (s)', min: 0.05, max: 8, step: 0.05, default: 1 },
    { kind: 'float', key: 'zoom', label: 'Zoom (×/s)', min: 0.25, max: 4, step: 0.01, default: 1.5 },
    { kind: 'float', key: 'rotate', label: 'Rotate (°/s)', min: -360, max: 360, step: 1, default: 20 },
    { kind: 'vec2', key: 'drift', label: 'Drift (/s)', min: -1, max: 1, step: 0.01, default: [0, 0] },
    { kind: 'float', key: 'hueShift', label: 'Hue Shift (°/s)', min: -360, max: 360, step: 1, default: 60 },
    { kind: 'vec2', key: 'center', label: 'Center', min: -0.5, max: 1.5, step: 0.01, default: [0.5, 0.5] },
    { kind: 'enum', key: 'mode', label: 'Mode', options: ['Over', 'Screen', 'Mix', 'Difference'], default: 0 },
    { kind: 'enum', key: 'edge', label: 'Edge', options: ['Clamp', 'Wrap', 'Black', 'Mirror'], default: 2 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);

  // Where this pixel was last frame: undo this frame's zoom, turn and drift.
  vec2 p = v_uv - u_center - u_drift * u_delta;
  p.x *= aspect;
  p /= pow(max(u_zoom, 0.001), u_delta);
  float a = -radians(u_rotate) * u_delta;
  p = vec2(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y);
  p.x /= aspect;

  vec4 prev = sampleEdge(u_prev, p + u_center, u_edge);
  float k = pow(0.1, u_delta / max(u_persistence, 0.001));
  vec3 echo = sat(hueRotate(prev.rgb, radians(u_hueShift) * u_delta));

  vec3 c;
  if (u_mode == 0) c = max(src.rgb, echo * k);
  else if (u_mode == 1) c = 1.0 - (1.0 - src.rgb) * (1.0 - echo * k);
  else if (u_mode == 2) c = mix(src.rgb, echo, k);
  else c = abs(src.rgb - echo * k);

  fragColor = vec4(sat(c), src.a);`,
};
