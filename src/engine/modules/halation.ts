import type { EffectDef } from '../effects';

/**
 * 35mm motion picture film halation (Kodak Vision3 emulsion glow).
 *
 * Bright highlights scatter through the film base and reflect off the
 * anti-halation backing, creating a warm, red-orange bloom around specular
 * edges and high-contrast silhouettes.
 */
const THRESHOLD = `  vec3 src = texture(u_src, v_uv).rgb;
  float l = luma(src);
  float keep = smoothstep(u_threshold, u_threshold + max(u_knee, 0.001), l);
  fragColor = vec4(src * u_tint * keep, 1.0);`;

const AXIS = `  vec2 dir = (u_pass == 1) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  fragColor = blurAxis(u_src, v_uv, u_resolution, dir, u_radius);`;

const COMBINE = `  vec4 base = texture(u_orig, v_uv);
  vec3 halo = texture(u_src, v_uv).rgb;
  fragColor = vec4(base.rgb + halo * u_intensity, base.a);`;

export const halation: EffectDef = {
  id: 'halation',
  label: 'Halation',
  category: 'optics',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'threshold', label: 'Threshold', min: 0.2, max: 1, step: 0.01, default: 0.65 },
    { kind: 'float', key: 'knee', label: 'Knee', min: 0.001, max: 0.5, step: 0.005, default: 0.15 },
    { kind: 'float', key: 'radius', label: 'Radius', min: 1, max: 48, step: 0.5, default: 14 },
    { kind: 'float', key: 'intensity', label: 'Intensity', min: 0, max: 2.5, step: 0.01, default: 0.9 },
    { kind: 'color', key: 'tint', label: 'Tint', default: [1.0, 0.22, 0.06] },
  ],
  fragment: [THRESHOLD, AXIS, AXIS, COMBINE],
};
