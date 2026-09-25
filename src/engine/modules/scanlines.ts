import type { EffectDef } from '../effects';

/**
 * Horizontal scanline darkening.
 *
 * Density is a count of lines down the whole picture, the way a CRT is
 * described, rather than a pitch in pixels. Pixels here would be working
 * pixels -- a frame of up to 2048 that is never shown at that size -- so a
 * pitch in them looked different on every photo and, at the small end,
 * was finer than the viewer could draw at all. A count looks the same on
 * any photo in any viewer. Lines too dense for a small viewer average out
 * to the tint they would really make, and come back as it is enlarged.
 *
 * Thickness is relative to the line, so it needs no unit: it shapes each
 * cycle, and the lines can be as dense as you like without it changing
 * meaning.
 *
 * Roll is the slow vertical drift of an unlocked vertical hold. At zero the
 * module is a still image, which is why `animated` is a function -- a
 * parked scanline node should not pin a frame loop for the whole session.
 */
export const scanlines: EffectDef = {
  id: 'scanlines',
  label: 'Scanlines',
  category: 'crt',
  animated: (params) => params.roll !== 0,
  mixable: true,
  params: [
    { kind: 'float', key: 'lines', label: 'Lines', min: 20, max: 1080, step: 1, default: 240 },
    { kind: 'float', key: 'thickness', label: 'Thickness', min: 0.1, max: 4, step: 0.05, default: 1 },
    { kind: 'float', key: 'darkness', label: 'Darkness', min: 0, max: 1, step: 0.01, default: 0.5 },
    { kind: 'float', key: 'roll', label: 'Roll', min: -5, max: 5, step: 0.05, default: 0 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float phase = v_uv.y * max(u_lines, 1.0) + u_phase_roll;
  // pow() on the raised sine shapes the duty cycle: >1 thins the bright
  // band towards a fine line, <1 fattens it towards a soft ripple.
  float s = pow(sin(phase * TAU) * 0.5 + 0.5, max(u_thickness, 0.01));
  fragColor = vec4(src.rgb * mix(1.0, s, u_darkness), src.a);`,
};
