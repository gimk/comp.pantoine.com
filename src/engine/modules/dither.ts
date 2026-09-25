import type { EffectDef } from '../effects';

/**
 * Ordered Bayer dithering for retro 1-bit Mac, Game Boy, and early VGA palettes.
 *
 * Quantizes luminance or color channels against a Bayer threshold matrix,
 * creating rhythmic cross-hatch stippling across gradients.
 */
export const dither: EffectDef = {
  id: 'dither',
  label: 'Dither',
  category: 'stylize',
  animated: false,
  mixable: true,
  params: [
    {
      kind: 'enum',
      key: 'matrix',
      label: 'Pattern',
      options: ['Bayer 2x2', 'Bayer 4x4', 'Bayer 8x8'],
      default: 1,
    },
    { kind: 'float', key: 'scale', label: 'Pattern Scale', min: 1, max: 8, step: 1, default: 1 },
    { kind: 'int', key: 'levels', label: 'Color Levels', min: 2, max: 16, default: 2 },
    { kind: 'bool', key: 'monochrome', label: 'Monochrome', default: false },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  ivec2 p = ivec2((v_uv * u_resolution) / max(u_scale, 1.0)) & 7;

  // Exact recursive Bayer threshold derivation in 0..1
  int b2 = ((p.x & 1) ^ (p.y & 1)) * 2 + (p.y & 1);
  ivec2 p4 = p & 3;
  int b4 = 4 * (((p4.x & 1) ^ (p4.y & 1)) * 2 + (p4.y & 1)) + (((p4.x >> 1) ^ (p4.y >> 1)) * 2 + (p4.y >> 1));
  ivec2 p8 = p;
  int b8 = 4 * b4 + (((p8.x >> 2) ^ (p8.y >> 2)) * 2 + (p8.y >> 2));

  float threshold;
  if (u_matrix == 0) {
    threshold = (float(b2) + 0.5) / 4.0;
  } else if (u_matrix == 1) {
    threshold = (float(b4) + 0.5) / 16.0;
  } else {
    threshold = (float(b8) + 0.5) / 64.0;
  }

  float offset = threshold - 0.5;
  float steps = float(max(u_levels - 1, 1));

  vec3 col = u_monochrome ? vec3(luma(src.rgb)) : src.rgb;
  col = clamp(floor((col + offset / steps) * steps + 0.5) / steps, 0.0, 1.0);

  fragColor = vec4(col, src.a);`,
};
