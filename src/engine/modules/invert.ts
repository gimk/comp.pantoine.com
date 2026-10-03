import type { EffectDef } from '../effects';

/**
 * A negative. Mix dials it back, which passes through flat grey on the
 * way -- a look of its own.
 */
export const invert: EffectDef = {
  id: 'invert',
  label: 'Invert',
  category: 'color',
  animated: false,
  mixable: true,
  params: [],
  fragment: `  vec4 src = texture(u_src, v_uv);
  fragColor = vec4(1.0 - src.rgb, src.a);`,
};
