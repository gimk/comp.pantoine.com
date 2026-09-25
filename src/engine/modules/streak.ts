import type { EffectDef } from '../effects';

/**
 * Anamorphic lens flare / horizontal streak.
 *
 * Simulates cylindrical anamorphic lens elements that stretch bright point
 * highlights into cinematic horizontal flare streaks with characteristic blue tint.
 */
const THRESHOLD = `  vec3 src = texture(u_src, v_uv).rgb;
  float l = luma(src);
  float keep = smoothstep(u_threshold, u_threshold + 0.1, l);
  fragColor = vec4(src * keep, 1.0);`;

const STREAK_PASS_1 = `  float rad = radians(u_angle);
  vec2 dir = vec2(cos(rad), sin(rad));
  fragColor = blurAxis(u_src, v_uv, u_resolution, dir, u_length * 0.35);`;

const STREAK_PASS_2 = `  float rad = radians(u_angle);
  vec2 dir = vec2(cos(rad), sin(rad));
  fragColor = blurAxis(u_src, v_uv, u_resolution, dir, u_length);`;

const COMBINE = `  vec4 base = texture(u_orig, v_uv);
  vec3 flare = texture(u_src, v_uv).rgb * u_tint * u_intensity;
  fragColor = vec4(base.rgb + flare, base.a);`;

export const streak: EffectDef = {
  id: 'streak',
  label: 'Anamorphic Streak',
  category: 'optics',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'threshold', label: 'Threshold', min: 0.3, max: 1, step: 0.01, default: 0.75 },
    { kind: 'float', key: 'length', label: 'Length', min: 4, max: 120, step: 1, default: 45 },
    { kind: 'float', key: 'angle', label: 'Angle', min: -30, max: 30, step: 0.5, default: 0 },
    { kind: 'float', key: 'intensity', label: 'Intensity', min: 0, max: 3, step: 0.01, default: 1.2 },
    { kind: 'color', key: 'tint', label: 'Tint', default: [0.2, 0.6, 1.0] },
  ],
  fragment: [THRESHOLD, STREAK_PASS_1, STREAK_PASS_2, COMBINE],
};
