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
  if (u_spill > 0.0) {
    // Despill reaches past the matte edge into the opaque fringe, fading out
    // at twice the tolerance: that fringe is where green bounce light sits
    // on hair and skin, and it is fully opaque, so gating on the mask missed it.
    float spillRange = u_tolerance * 2.0 + max(u_softness, 0.001);
    float spillW = 1.0 - smoothstep(u_tolerance, spillRange, d);

    // Classic despill: clamp the key's dominant channel down to the average
    // of the other two, which removes the key hue without greying the rest.
    vec3 k = u_keyColor;
    if (k.g >= k.r && k.g >= k.b) {
      rgb.g -= max(rgb.g - 0.5 * (rgb.r + rgb.b), 0.0) * u_spill * spillW;
    } else if (k.b >= k.r) {
      rgb.b -= max(rgb.b - 0.5 * (rgb.r + rgb.g), 0.0) * u_spill * spillW;
    } else {
      rgb.r -= max(rgb.r - 0.5 * (rgb.g + rgb.b), 0.0) * u_spill * spillW;
    }
  }

  fragColor = vec4(rgb, src.a * maskVal);`,
};
