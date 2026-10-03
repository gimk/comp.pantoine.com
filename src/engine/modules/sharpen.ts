import type { EffectDef } from '../effects';

/**
 * Unsharp mask: blur a copy, take what the blur took away -- the detail --
 * and add more of it back.
 *
 * Threshold leaves detail smaller than it alone, so a flat sky or a noisy
 * shadow is not sharpened into grit; it opens with a soft ramp rather than
 * a cut, or the edge of what counts as detail would itself show. Luma Only
 * sharpens brightness and not colour, which is what keeps sharpened edges
 * from growing coloured fringes.
 */
const AXIS = `  vec2 dir = (u_pass == 0) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  fragColor = blurAxis(u_src, v_uv, u_resolution, dir, u_radius * u_pixel_scale);`;

const COMBINE = `  vec4 orig = texture(u_orig, v_uv);
  vec3 detail = orig.rgb - texture(u_src, v_uv).rgb;
  float size = abs(luma(detail));
  float gate = smoothstep(u_threshold, u_threshold * 2.0 + 0.001, size);
  vec3 added = u_lumaOnly ? vec3(luma(detail)) : detail;
  fragColor = vec4(sat(orig.rgb + added * u_amount * gate), orig.a);`;

export const sharpen: EffectDef = {
  id: 'sharpen',
  label: 'Sharpen',
  category: 'optics',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'amount', label: 'Amount', min: 0, max: 5, step: 0.01, default: 1 },
    { kind: 'float', key: 'radius', label: 'Radius', min: 0.5, max: 10, step: 0.1, default: 1.5 },
    { kind: 'float', key: 'threshold', label: 'Threshold', min: 0, max: 0.5, step: 0.005, default: 0.02 },
    { kind: 'bool', key: 'lumaOnly', label: 'Luma Only', default: true },
  ],
  fragment: [AXIS, AXIS, COMBINE],
};
