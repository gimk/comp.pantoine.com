import type { EffectDef } from '../effects';

/**
 * Radial zoom and spin blur.
 *
 * Simulates high-speed camera motion, zoom bursts, or rotational momentum
 * radiating from a configurable center point.
 */
export const radialBlur: EffectDef = {
  id: 'radialBlur',
  label: 'Radial Blur',
  category: 'optics',
  animated: false,
  mixable: true,
  params: [
    { kind: 'enum', key: 'mode', label: 'Mode', options: ['Zoom', 'Spin'], default: 0 },
    { kind: 'float', key: 'amount', label: 'Amount', min: 0, max: 0.3, step: 0.002, default: 0.05 },
    { kind: 'vec2', key: 'center', label: 'Center', min: -0.5, max: 1.5, step: 0.01, default: [0.5, 0.5] },
  ],
  fragment: `  vec2 p = v_uv - u_center;
  vec2 delta;
  if (u_mode == 0) {
    delta = p * u_amount;
  } else {
    // Tangential direction for spin, taken in square units so the arc is a
    // circle rather than an ellipse stretched to the frame's aspect.
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    vec2 q = p * vec2(aspect, 1.0);
    delta = vec2(-q.y, q.x) * u_amount / vec2(aspect, 1.0);
  }

  vec4 sum = vec4(0.0);
  const int TAPS = 16;
  for (int i = 0; i < TAPS; i++) {
    float t = float(i) / float(TAPS - 1) - 0.5;
    sum += sampleEdge(u_src, v_uv + delta * t, 0);
  }

  fragColor = sum / float(TAPS);`,
};
