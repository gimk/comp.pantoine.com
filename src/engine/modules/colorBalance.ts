import type { EffectDef } from '../effects';

/**
 * Tints the shadows, midtones and highlights each their own colour -- teal
 * shadows under warm highlights, and the rest of the grading look book.
 *
 * White is neutral. Each colour is normalised to its own luma before it is
 * applied, so a tint shifts hue without darkening, and each is weighted by a
 * smooth mask over the tonal range so the three blend into one another.
 */
export const colorBalance: EffectDef = {
  id: 'colorBalance',
  label: 'Color Balance',
  category: 'color',
  animated: false,
  mixable: true,
  params: [
    { kind: 'color', key: 'shadows', label: 'Shadows', default: [1, 1, 1] },
    { kind: 'color', key: 'midtones', label: 'Midtones', default: [1, 1, 1] },
    { kind: 'color', key: 'highlights', label: 'Highlights', default: [1, 1, 1] },
    { kind: 'float', key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float y = sat(luma(src.rgb));
  float wShadows = 1.0 - smoothstep(0.0, 0.5, y);
  float wHighlights = smoothstep(0.5, 1.0, y);
  float wMidtones = 1.0 - wShadows - wHighlights;
  vec3 tShadows = u_shadows / max(luma(u_shadows), 0.0001);
  vec3 tMidtones = u_midtones / max(luma(u_midtones), 0.0001);
  vec3 tHighlights = u_highlights / max(luma(u_highlights), 0.0001);
  vec3 tint = tShadows * wShadows + tMidtones * wMidtones + tHighlights * wHighlights;
  vec3 c = src.rgb * mix(vec3(1.0), tint, u_strength);
  fragColor = vec4(c, src.a);`,
};
