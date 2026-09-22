import type { EffectDef } from '../effects';

/**
 * Horizontal scanline darkening.
 *
 * Pitch is in working pixels rather than a line count, so the lines keep
 * their apparent size when the working resolution changes instead of
 * bunching up on a larger image.
 *
 * Roll is the slow vertical drift of an unlocked vertical hold. At zero the
 * module is a still image, which is why `animated` is a function -- a
 * parked scanline node should not pin a frame loop for the whole session.
 */
export const scanlines: EffectDef = {
  id: 'scanlines',
  label: 'Scanlines',
  category: 'scan',
  animated: (params) => params.roll !== 0,
  mixable: true,
  params: [
    { kind: 'float', key: 'pitch', label: 'Pitch', min: 1, max: 20, step: 0.1, default: 3 },
    { kind: 'float', key: 'thickness', label: 'Thickness', min: 0.1, max: 4, step: 0.05, default: 1 },
    { kind: 'float', key: 'darkness', label: 'Darkness', min: 0, max: 1, step: 0.01, default: 0.5 },
    { kind: 'float', key: 'roll', label: 'Roll', min: -5, max: 5, step: 0.05, default: 0 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float y = v_uv.y * u_resolution.y;
  float phase = y / max(u_pitch, 1.0) + u_time * u_roll;
  // pow() on the raised sine shapes the duty cycle: >1 thins the bright
  // band towards a fine line, <1 fattens it towards a soft ripple.
  float s = pow(sin(phase * TAU) * 0.5 + 0.5, max(u_thickness, 0.01));
  fragColor = vec4(src.rgb * mix(1.0, s, u_darkness), src.a);`,
};
