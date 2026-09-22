import type { EffectDef } from '../effects';

/**
 * Red and blue pulled apart, green left where it is.
 *
 * Two kinds at once because real optics and real signals do both. Radial
 * grows with distance from the centre and vanishes in the middle, which is
 * what a lens does. Lateral is a flat sideways shift across the whole frame,
 * which is what a badly timed signal does.
 *
 * Green stays put in both: the eye reads detail mostly from green, so
 * splitting the outer two around it keeps the picture legible while the
 * fringing still shows.
 */
export const chromaticAberration: EffectDef = {
  id: 'chromaticAberration',
  label: 'Chromatic Aberration',
  category: 'color',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'radial', label: 'Radial', min: -0.1, max: 0.1, step: 0.001, default: 0.008 },
    { kind: 'float', key: 'lateral', label: 'Lateral', min: -16, max: 16, step: 0.5, default: 0 },
    { kind: 'vec2', key: 'center', label: 'Center', min: 0, max: 1, step: 0.01, default: [0.5, 0.5] },
  ],
  fragment: `  vec2 radial = (v_uv - u_center) * u_radial;
  vec2 lateral = vec2(u_lateral / max(u_resolution.x, 1.0), 0.0);
  vec2 shift = radial + lateral;

  vec4 src = texture(u_src, v_uv);
  fragColor = vec4(
    texture(u_src, v_uv + shift).r,
    src.g,
    texture(u_src, v_uv - shift).b,
    src.a
  );`,
};
