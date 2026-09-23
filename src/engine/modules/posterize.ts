import type { EffectDef } from '../effects';

/**
 * Quantisation to a fixed number of steps.
 *
 * Two modes, because they fail differently and both failures are useful:
 * RGB quantises each channel independently and drifts the hue as it does
 * (the banded, cheap-digital look), while Luma quantises brightness only
 * and scales the colour back up, holding the hue intact.
 */
export const posterize: EffectDef = {
  id: 'posterize',
  label: 'Posterize',
  category: 'stylize',
  animated: false,
  mixable: true,
  params: [
    { kind: 'int', key: 'levels', label: 'Levels', min: 2, max: 32, default: 6 },
    { kind: 'enum', key: 'mode', label: 'Mode', options: ['RGB', 'Luma'], default: 0 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float steps = max(float(u_levels), 2.0);
  vec3 c;
  if (u_mode == 0) {
    c = floor(src.rgb * steps + 0.5) / steps;
  } else {
    float l = luma(src.rgb);
    float q = floor(l * steps + 0.5) / steps;
    // Guard the divide: a black pixel has no hue to preserve anyway.
    c = src.rgb * (q / max(l, 0.001));
  }
  fragColor = vec4(c, src.a);`,
};
