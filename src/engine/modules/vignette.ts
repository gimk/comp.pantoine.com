import type { EffectDef } from '../effects';

/**
 * Darkened (or tinted) falloff towards the edges.
 *
 * The distance is aspect-corrected, so on a wide image the vignette stays
 * circular instead of being stretched into an ellipse by the UV space.
 * Centre is exposed because an off-centre vignette is how you fake a light
 * source sitting off to one side.
 */
export const vignette: EffectDef = {
  id: 'vignette',
  label: 'Vignette',
  category: 'frame',
  animated: false,
  params: [
    { kind: 'vec2', key: 'center', label: 'Center', min: 0, max: 1, step: 0.01, default: [0.5, 0.5] },
    { kind: 'float', key: 'radius', label: 'Radius', min: 0, max: 1.2, step: 0.01, default: 0.7 },
    { kind: 'float', key: 'softness', label: 'Softness', min: 0.01, max: 1, step: 0.01, default: 0.35 },
    { kind: 'float', key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, default: 0.6 },
    { kind: 'color', key: 'color', label: 'Color', default: [0, 0, 0] },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (v_uv - u_center) * vec2(aspect, 1.0);
  float d = length(p);
  float falloff = 1.0 - smoothstep(u_radius, u_radius + u_softness, d);
  fragColor = vec4(mix(u_color, src.rgb, mix(1.0, falloff, u_strength)), src.a);`,
};
