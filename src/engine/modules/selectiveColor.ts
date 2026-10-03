import type { EffectDef } from '../effects';

/**
 * Adjusts one band of hues and leaves the rest alone -- or, with Outside
 * Saturation at zero, greys out everything but that band: the red coat in
 * a black-and-white street.
 *
 * The band is a hue and a half-width either side of it, feathered by
 * Softness. Selection also fades out as a pixel loses saturation, since a
 * grey's hue is noise: without that, every near-grey pixel would flicker
 * in and out of the band.
 *
 * Hue is a slider in degrees rather than a colour pick so a signal can
 * sweep it round the wheel.
 */
export const selectiveColor: EffectDef = {
  id: 'selectiveColor',
  label: 'Selective Color',
  category: 'color',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'hue', label: 'Hue (°)', min: 0, max: 360, step: 1, default: 0 },
    { kind: 'float', key: 'range', label: 'Range (°)', min: 0, max: 180, step: 1, default: 25 },
    { kind: 'float', key: 'softness', label: 'Softness (°)', min: 0, max: 90, step: 1, default: 15 },
    { kind: 'float', key: 'hueShift', label: 'Hue Shift (°)', min: -180, max: 180, step: 1, default: 0 },
    { kind: 'float', key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, default: 1 },
    { kind: 'float', key: 'lightness', label: 'Lightness', min: -1, max: 1, step: 0.01, default: 0 },
    { kind: 'float', key: 'outside', label: 'Outside Saturation', min: 0, max: 1, step: 0.01, default: 1 },
    { kind: 'bool', key: 'showMask', label: 'Show Mask', default: false },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  vec3 c = src.rgb;
  float hi = max(c.r, max(c.g, c.b));
  float lo = min(c.r, min(c.g, c.b));
  float chroma = hi - lo;
  float h = 0.0;
  if (chroma > 0.0) {
    if (hi == c.r) h = mod((c.g - c.b) / chroma, 6.0);
    else if (hi == c.g) h = (c.b - c.r) / chroma + 2.0;
    else h = (c.r - c.g) / chroma + 4.0;
  }
  float pixelSat = hi > 0.0 ? chroma / hi : 0.0;

  // Distance round the wheel, in degrees, 0..180.
  float d = abs(mod(h * 60.0 - u_hue + 180.0, 360.0) - 180.0);
  float w = 1.0 - smoothstep(u_range, u_range + max(u_softness, 0.001), d);
  w *= smoothstep(0.02, 0.15, pixelSat);

  if (u_showMask) {
    fragColor = vec4(vec3(w), src.a);
  } else {
    vec3 inside = hueRotate(c, radians(u_hueShift));
    inside = mix(vec3(luma(inside)), inside, u_saturation) + u_lightness;
    vec3 outside = mix(vec3(luma(c)), c, u_outside);
    fragColor = vec4(sat(mix(outside, inside, w)), src.a);
  }`,
};
