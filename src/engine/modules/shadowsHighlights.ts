import type { EffectDef } from '../effects';

/**
 * Lifts or crushes the dark end and recovers or pushes the bright end, each
 * without touching the other -- the photo editor's first two sliders.
 *
 * Each side is weighted by a smooth mask on luma, so the shift fades out
 * through the midtones rather than drawing a line where it stops. The shift
 * is applied to luma and the colour scaled to match, which keeps hues from
 * washing out as they would if each channel were pushed on its own.
 */
export const shadowsHighlights: EffectDef = {
  id: 'shadowsHighlights',
  label: 'Shadows & Highlights',
  category: 'color',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'shadows', label: 'Shadows', min: -1, max: 1, step: 0.01, default: 0 },
    { kind: 'float', key: 'highlights', label: 'Highlights', min: -1, max: 1, step: 0.01, default: 0 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float y = luma(src.rgb);
  float shadowMask = 1.0 - smoothstep(0.0, 0.5, y);
  float highlightMask = smoothstep(0.5, 1.0, y);
  float target = y + u_shadows * shadowMask * 0.5 + u_highlights * highlightMask * 0.5;
  vec3 c = y > 0.0001 ? src.rgb * (max(target, 0.0) / y) : vec3(max(target, 0.0));
  fragColor = vec4(c, src.a);`,
};
