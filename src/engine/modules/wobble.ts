import type { EffectDef } from '../effects';

/**
 * A travelling wave that displaces the picture -- the image-space half of
 * "modulation".
 *
 * Frequency is how many cycles fit across the image and Rate is how fast
 * they travel, which are independent: a slow fat swell and a fast fine
 * ripple are the same module at opposite ends of two knobs.
 *
 * On Both, the vertical wave is pushed out of phase with the horizontal one
 * by an arbitrary fraction. Left aligned, the two axes would move together
 * and the result would just be a diagonal wobble rather than a churn.
 */
export const wobble: EffectDef = {
  id: 'wobble',
  label: 'Wobble',
  category: 'geometry',
  animated: (params) => params.rate !== 0,
  params: [
    { kind: 'enum', key: 'waveform', label: 'Waveform', options: ['Sine', 'Triangle', 'Square', 'Noise'], default: 0 },
    { kind: 'float', key: 'amplitude', label: 'Amplitude', min: 0, max: 0.2, step: 0.001, default: 0.01 },
    { kind: 'float', key: 'frequency', label: 'Frequency', min: 0.5, max: 40, step: 0.5, default: 6 },
    { kind: 'float', key: 'rate', label: 'Rate', min: -4, max: 4, step: 0.05, default: 0.5 },
    { kind: 'float', key: 'phase', label: 'Phase', min: 0, max: 1, step: 0.01, default: 0 },
    { kind: 'enum', key: 'axis', label: 'Axis', options: ['Horizontal', 'Vertical', 'Both'], default: 0 },
    { kind: 'enum', key: 'edge', label: 'Edge', options: ['Clamp', 'Wrap', 'Black', 'Mirror'], default: 0 },
  ],
  fragment: `  float t = u_time * u_rate + u_phase;
  vec2 uv = v_uv;

  // The wave runs along the axis it is not displacing, which is what makes
  // a horizontal shift read as a row-by-row wobble down the picture.
  if (u_axis == 0) {
    uv.x += wave(v_uv.y * u_frequency + t, u_waveform) * u_amplitude;
  } else if (u_axis == 1) {
    uv.y += wave(v_uv.x * u_frequency + t, u_waveform) * u_amplitude;
  } else {
    uv.x += wave(v_uv.y * u_frequency + t, u_waveform) * u_amplitude;
    uv.y += wave(v_uv.x * u_frequency + t + 0.37, u_waveform) * u_amplitude;
  }

  fragColor = sampleEdge(u_src, uv, u_edge);`,
};
