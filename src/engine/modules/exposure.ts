import type { EffectDef } from '../effects';

/**
 * Exposure in stops, as a camera counts it: +1 doubles the light, -1 halves
 * it. A multiply rather than Levels' add, so black stays black and the
 * picture brightens the way more light would, not the way a grey wash does.
 */
export const exposure: EffectDef = {
  id: 'exposure',
  label: 'Exposure',
  category: 'color',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'exposure', label: 'Exposure', min: -4, max: 4, step: 0.01, default: 0 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  fragColor = vec4(src.rgb * exp2(u_exposure), src.a);`,
};
