import type { EffectDef } from '../effects';

/**
 * Short bright dashes where the tape lost contact with the head.
 *
 * Addressed by line and by segment along the line, so a dropout is a
 * horizontal dash of a definite length rather than a scatter of pixels --
 * that shape is the whole difference between tape damage and grain.
 *
 * Held for whole steps at Rate, since a physical flaw persists for a beat.
 */
export const dropouts: EffectDef = {
  id: 'dropouts',
  label: 'Dropouts',
  category: 'noise',
  animated: (params) => params.rate !== 0,
  params: [
    { kind: 'float', key: 'density', label: 'Density', min: 0, max: 1, step: 0.005, default: 0.04 },
    { kind: 'float', key: 'length', label: 'Length', min: 2, max: 200, step: 1, default: 40 },
    { kind: 'float', key: 'thickness', label: 'Thickness', min: 1, max: 20, step: 0.5, default: 2 },
    { kind: 'float', key: 'rate', label: 'Rate', min: 0, max: 60, step: 1, default: 8 },
    { kind: 'color', key: 'color', label: 'Color', default: [1, 1, 1] },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float line = floor(v_uv.y * u_resolution.y / max(u_thickness, 1.0));
  float seg = floor(v_uv.x * u_resolution.x / max(u_length, 1.0));
  float tick = floor(u_time * u_rate);

  // The 91 spreads consecutive lines apart in the hash's input, so
  // neighbouring rows do not draw near-identical values.
  float n = hash12(vec2(line * 91.0 + seg, tick + u_seed * 517.0));
  float hit = step(1.0 - u_density, n);

  fragColor = vec4(mix(src.rgb, u_color, hit), src.a);`,
};
