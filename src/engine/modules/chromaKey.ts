import type { EffectDef } from '../effects';

/**
 * Chroma keyer / green & blue screen extractor with edge spill suppression.
 *
 * Keys out a selected background color by calculating color distance, feathering
 * the edge, and neutralizing unwanted colored light bounce on hair and edges.
 */
export const chromaKey: EffectDef = {
  id: 'chromaKey',
  label: 'Chroma Key',
  category: 'composite',
  animated: false,
  mixable: true,
  params: [
    { kind: 'color', key: 'keyColor', label: 'Key Color', default: [0.0, 1.0, 0.0] },
    { kind: 'float', key: 'tolerance', label: 'Tolerance', min: 0.01, max: 1.0, step: 0.01, default: 0.35 },
    { kind: 'float', key: 'softness', label: 'Softness', min: 0.001, max: 0.5, step: 0.005, default: 0.1 },
    { kind: 'float', key: 'spill', label: 'Spill Suppression', min: 0.0, max: 1.0, step: 0.01, default: 0.5 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float d = distance(src.rgb, u_keyColor);
  float maskVal = smoothstep(u_tolerance, u_tolerance + max(u_softness, 0.001), d);

  vec3 rgb = src.rgb;
  if (u_spill > 0.0 && maskVal < 1.0) {
    float keyMatch = max(0.0, 1.0 - d / max(u_tolerance * 2.0, 0.001));
    vec3 neutral = vec3(luma(rgb));
    rgb = mix(rgb, neutral, keyMatch * u_spill);
  }

  fragColor = vec4(rgb, src.a * maskVal);`,
};
