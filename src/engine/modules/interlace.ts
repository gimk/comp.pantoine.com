import type { EffectDef } from '../effects';

/**
 * Alternating fields: odd lines on one frame, even on the next.
 *
 * Two artefacts in one, because they are the same mechanism. Dim is the
 * inactive field fading between refreshes -- the flicker. Shift displaces
 * the two fields vertically, which is what makes movement comb apart the
 * way an interlaced still of a moving subject does.
 *
 * At Rate 0 the fields stop alternating and this becomes a static line
 * structure, which is a legitimate place to park it.
 */
export const interlace: EffectDef = {
  id: 'interlace',
  label: 'Interlace',
  category: 'scan',
  animated: (params) => params.rate !== 0,
  params: [
    { kind: 'float', key: 'thickness', label: 'Thickness', min: 1, max: 12, step: 0.5, default: 1 },
    { kind: 'float', key: 'dim', label: 'Dim', min: 0, max: 1, step: 0.01, default: 0.35 },
    { kind: 'float', key: 'shift', label: 'Shift', min: 0, max: 8, step: 0.5, default: 0 },
    { kind: 'float', key: 'rate', label: 'Rate', min: 0, max: 60, step: 1, default: 30 },
  ],
  fragment: `  float row = floor(v_uv.y * u_resolution.y / max(u_thickness, 1.0));
  float odd = mod(row, 2.0);
  float field = mod(floor(u_time * u_rate), 2.0);
  // "active" is a reserved word in GLSL ES -- do not name anything that.
  bool lit = (odd == field);

  float offset = (lit ? u_shift : -u_shift) / max(u_resolution.y, 1.0);
  vec4 c = texture(u_src, vec2(v_uv.x, v_uv.y + offset));

  fragColor = vec4(c.rgb * (lit ? 1.0 : 1.0 - u_dim), c.a);`,
};
