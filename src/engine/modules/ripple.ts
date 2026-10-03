import type { EffectDef } from '../effects';

/**
 * Rings spreading from a point, as on water after a stone goes in.
 *
 * Each pixel is pushed toward or away from Center by a sine of its
 * distance, so the picture bends along circles; Speed sends the circles
 * outward. Speed is phased, so changing it mid-play never jumps the rings.
 * Decay fades the waves with distance -- at 0 they run to the frame's edge
 * at full height. Measured in square units, so the rings are round.
 */
export const ripple: EffectDef = {
  id: 'ripple',
  label: 'Ripple',
  category: 'geometry',
  animated: (params) => params.speed !== 0,
  mixable: true,
  params: [
    { kind: 'vec2', key: 'center', label: 'Center', min: -0.5, max: 1.5, step: 0.01, default: [0.5, 0.5] },
    { kind: 'float', key: 'amplitude', label: 'Amplitude', min: 0, max: 0.1, step: 0.001, default: 0.01 },
    { kind: 'float', key: 'wavelength', label: 'Wavelength', min: 0.01, max: 0.5, step: 0.005, default: 0.08 },
    { kind: 'float', key: 'speed', label: 'Speed', min: -4, max: 4, step: 0.01, default: 0.5 },
    { kind: 'float', key: 'decay', label: 'Decay', min: 0, max: 10, step: 0.1, default: 2 },
    { kind: 'enum', key: 'edge', label: 'Edge', options: ['Clamp', 'Wrap', 'Black', 'Mirror'], default: 0 },
  ],
  fragment: `  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (v_uv - u_center) * vec2(aspect, 1.0);
  float d = length(p);
  vec2 dir = d > 1e-5 ? p / d : vec2(0.0);
  float wave = sin(6.2831853 * (d / max(u_wavelength, 0.001) - u_phase_speed));
  vec2 offset = dir * u_amplitude * wave * exp(-u_decay * d);
  fragColor = sampleEdge(u_src, v_uv + offset / vec2(aspect, 1.0), u_edge);`,
};
