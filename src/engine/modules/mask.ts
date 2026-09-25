import type { EffectDef } from '../effects';

/**
 * Cut the picture away using another node's output as an alpha or luma matte.
 *
 * The counterpart to Blend: where Blend lays one picture on top of another,
 * Mask carves one picture out with another. An unplugged Matte input passes
 * the picture through untouched so the node does not blank out while wiring.
 */
export const mask: EffectDef = {
  id: 'mask',
  label: 'Mask',
  category: 'composite',
  animated: false,
  mixable: true,
  inputs: [{ key: 'matte', label: 'Matte' }],
  params: [
    {
      kind: 'enum',
      key: 'source',
      label: 'Source',
      options: ['Luma', 'Alpha', 'Red', 'Green', 'Blue'],
      default: 0,
    },
    { kind: 'bool', key: 'invert', label: 'Invert', default: false },
    { kind: 'float', key: 'blackPoint', label: 'Black Point', min: 0, max: 1, step: 0.01, default: 0 },
    { kind: 'float', key: 'whitePoint', label: 'White Point', min: 0, max: 1, step: 0.01, default: 1 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  if (textureSize(u_matte, 0).x <= 1) {
    fragColor = src;
  } else {
    vec4 m = texture(u_matte, v_uv);
    float val;
    if (u_source == 0) val = luma(m.rgb);
    else if (u_source == 1) val = m.a;
    else if (u_source == 2) val = m.r;
    else if (u_source == 3) val = m.g;
    else val = m.b;

    if (u_invert) val = 1.0 - val;

    float range = max(u_whitePoint - u_blackPoint, 0.0001);
    float maskVal = clamp((val - u_blackPoint) / range, 0.0, 1.0);

    fragColor = vec4(src.rgb, src.a * maskVal);
  }`,
};
