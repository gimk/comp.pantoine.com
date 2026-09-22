import type { EffectDef } from '../effects';

/**
 * Luma sharp, chroma smeared sideways -- the single most recognisable thing
 * about tape.
 *
 * It is not a blur of the picture: the format gave colour far less
 * bandwidth than brightness, so edges stay crisp while the colour runs past
 * them. This reconstructs that directly -- brightness is taken from the
 * untouched pixel, colour from a horizontally blurred one.
 *
 * Single pass, since the bleed only ever runs along the scan direction.
 *
 * Offset slides the colour relative to the brightness, which is the other
 * half of the look: the red of a jacket arriving a few pixels late.
 */
export const chromaBleed: EffectDef = {
  id: 'chromaBleed',
  label: 'Chroma Bleed',
  category: 'color',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'width', label: 'Width', min: 0, max: 64, step: 0.5, default: 12 },
    { kind: 'float', key: 'offset', label: 'Offset', min: -32, max: 32, step: 0.5, default: 0 },
    { kind: 'float', key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, default: 1 },
  ],
  fragment: `  vec3 sharp = texture(u_src, v_uv).rgb;
  vec2 shifted = v_uv + vec2(u_offset / max(u_resolution.x, 1.0), 0.0);
  vec3 soft = blurAxis(u_src, shifted, u_resolution, vec2(1.0, 0.0), u_width).rgb;

  // Colour as its departure from grey, so recombining it with a different
  // brightness cannot also drag that brightness along with it.
  vec3 chroma = soft - vec3(luma(soft));
  fragColor = vec4(vec3(luma(sharp)) + chroma * u_saturation, texture(u_src, v_uv).a);`,
};
