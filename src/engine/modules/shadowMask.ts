import type { EffectDef } from '../effects';

/**
 * The RGB pattern a tube's aperture lifts off the phosphor.
 *
 * Built from three phase-shifted cosines rather than hard stripes: a
 * pattern this fine aliases badly against the pixel grid, and a smooth one
 * degrades into an even tint as it goes sub-pixel instead of into moire.
 *
 * The 1.6 gain is a partial brightness repay. A mask whose average is 0.5
 * halves the picture, and the three types do not all average the same, so
 * the compensation is deliberately approximate -- follow with Levels.
 */
export const shadowMask: EffectDef = {
  id: 'shadowMask',
  label: 'Shadow Mask',
  category: 'crt',
  animated: false,
  mixable: true,
  params: [
    { kind: 'enum', key: 'type', label: 'Type', options: ['Grille', 'Slot', 'Dot'], default: 0 },
    { kind: 'float', key: 'pitch', label: 'Pitch', min: 1, max: 24, step: 0.5, default: 3 },
    { kind: 'float', key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  vec2 px = v_uv * u_resolution / max(u_pitch, 1.0);

  // Slot staggers every other row by half a triad, which is what breaks a
  // grille's continuous vertical stripes into brickwork.
  float stagger = (u_type == 1) ? mod(floor(px.y), 2.0) * 0.5 : 0.0;
  vec3 mask = 0.5 + 0.5 * cos((px.x + stagger) * TAU + vec3(0.0, 2.0943951, 4.1887902));

  // Dot adds the horizontal gaps a shadow mask has and a grille does not.
  if (u_type == 2) mask *= 0.5 + 0.5 * cos(px.y * TAU);

  fragColor = vec4(src.rgb * mix(vec3(1.0), mask * 1.6, u_strength), src.a);`,
};
