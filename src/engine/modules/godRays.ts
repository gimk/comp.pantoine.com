import type { EffectDef } from '../effects';

/**
 * Light shafts: the bright parts of the picture smeared out along lines
 * that run to a light, as sun through mist or a window into a dusty room.
 *
 * Three passes, after Bloom: keep what is bright (with the same soft knee),
 * march each pixel a fixed number of steps toward the light summing what
 * it passes with each step weighing Decay times the last, then add the
 * result back onto the picture. The step count is fixed and Length scales
 * the stride, so a long ray costs the same as a short one.
 */
const THRESHOLD = `  vec4 src = texture(u_src, v_uv);
  float keep = smoothstep(u_threshold, u_threshold + max(u_knee, 0.001), luma(src.rgb)) * src.a;
  fragColor = vec4(src.rgb * keep, 1.0);`;

const MARCH = `  const int TAPS = 48;
  vec2 stride = (u_light - v_uv) * u_length / float(TAPS);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  float w = 1.0;
  for (int i = 0; i < TAPS; i++) {
    vec2 p = v_uv + stride * float(i);
    // Off the frame there is nothing lit to pass through.
    if (p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) sum += texture(u_src, p).rgb * w;
    total += w;
    w *= u_decay;
  }
  fragColor = vec4(sum / total, 1.0);`;

const COMBINE = `  vec4 base = texture(u_orig, v_uv);
  vec3 rays = texture(u_src, v_uv).rgb;
  fragColor = vec4(base.rgb + rays * u_tint * u_intensity, base.a);`;

export const godRays: EffectDef = {
  id: 'godRays',
  label: 'God Rays',
  category: 'optics',
  animated: false,
  params: [
    { kind: 'float', key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.7 },
    { kind: 'float', key: 'knee', label: 'Knee', min: 0.001, max: 0.5, step: 0.005, default: 0.15 },
    { kind: 'vec2', key: 'light', label: 'Light', min: -0.5, max: 1.5, step: 0.01, default: [0.5, 0.75] },
    { kind: 'float', key: 'length', label: 'Length', min: 0, max: 1, step: 0.01, default: 0.5 },
    { kind: 'float', key: 'decay', label: 'Decay', min: 0.8, max: 1, step: 0.001, default: 0.96 },
    { kind: 'float', key: 'intensity', label: 'Intensity', min: 0, max: 4, step: 0.01, default: 1.2 },
    { kind: 'color', key: 'tint', label: 'Tint', default: [1, 0.92, 0.75] },
  ],
  fragment: [THRESHOLD, MARCH, COMBINE],
};
