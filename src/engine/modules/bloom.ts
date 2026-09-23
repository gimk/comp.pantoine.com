import type { EffectDef } from '../effects';

/**
 * Phosphor glow: isolate what is bright, blur it, add it back.
 *
 * Four passes -- threshold, blur across, blur down, combine -- and the
 * combine is the one that needs `u_orig`. By then `u_src` holds nothing but
 * the blurred highlights; the picture they have to be added back onto is
 * long gone from the ping-pong, which is exactly what the hold buffer is
 * there for.
 *
 * The threshold has a soft knee rather than a hard cut. A hard one makes
 * the glow pop into existence along a contour as the slider moves, and that
 * contour is visible in the result.
 */
const THRESHOLD = `  vec3 src = texture(u_src, v_uv).rgb;
  float l = luma(src);
  // Smoothstep over a band around the threshold, so highlights fade into
  // the glow instead of switching on at an edge.
  float keep = smoothstep(u_threshold, u_threshold + max(u_knee, 0.001), l);
  fragColor = vec4(src * keep, 1.0);`;

const AXIS = `  vec2 dir = (u_pass == 1) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  fragColor = blurAxis(u_src, v_uv, u_resolution, dir, u_radius);`;

const COMBINE = `  vec4 base = texture(u_orig, v_uv);
  vec3 glow = texture(u_src, v_uv).rgb;
  fragColor = vec4(base.rgb + glow * u_intensity, base.a);`;

export const bloom: EffectDef = {
  id: 'bloom',
  label: 'Bloom',
  category: 'optics',
  animated: false,
  params: [
    { kind: 'float', key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.6 },
    { kind: 'float', key: 'knee', label: 'Knee', min: 0.001, max: 0.5, step: 0.005, default: 0.15 },
    { kind: 'float', key: 'radius', label: 'Radius', min: 0, max: 64, step: 0.5, default: 16 },
    { kind: 'float', key: 'intensity', label: 'Intensity', min: 0, max: 3, step: 0.01, default: 0.8 },
  ],
  fragment: [THRESHOLD, AXIS, AXIS, COMBINE],
};
