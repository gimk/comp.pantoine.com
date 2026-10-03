import type { EffectDef } from '../effects';

/**
 * Lens flare made from the picture's own highlights, so it works on any
 * footage with nothing to place by hand: every bright spot throws ghosts
 * across the frame and a halo around it, as light bouncing between lens
 * elements does.
 *
 * After John Chapman's pseudo lens flare. A real lens images each ghost of
 * a light on the line through the frame's centre, on the far side -- so
 * the highlights are mirrored through the centre and sampled at steps of
 * Spacing back along that line, each step a ghost. The halo is the same
 * picture sampled a fixed distance out along the line instead, which turns
 * a spot near the centre into a ring. Dispersion reads red and blue a
 * little either side of green along the line, for the coloured fringes a
 * flare always has. Ghosts fade toward the frame's edge so they never end
 * at a hard line, then the whole flare is blurred and added on.
 */
const THRESHOLD = `  vec4 src = texture(u_src, v_uv);
  float keep = smoothstep(u_threshold, u_threshold + max(u_knee, 0.001), luma(src.rgb)) * src.a;
  fragColor = vec4(src.rgb * keep, 1.0);`;

const GHOSTS = `  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 uv = 1.0 - v_uv;
  vec2 toCenter = 0.5 - uv;
  vec2 dir = length(toCenter) > 1e-5 ? normalize(toCenter) : vec2(0.0);
  vec2 fringe = dir * u_dispersion * u_pixel_scale / u_resolution;
  const float CORNER = 0.70710678;

  vec3 flare = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= u_ghosts) break;
    vec2 p = uv + toCenter * u_spacing * float(i);
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) continue;
    float w = pow(1.0 - min(length(0.5 - p) / CORNER, 1.0), 10.0);
    flare += vec3(
      texture(u_src, p - fringe).r,
      texture(u_src, p).g,
      texture(u_src, p + fringe).b
    ) * w;
  }

  if (u_halo > 0.0) {
    // A fixed distance out along the line, in square units so it is a ring.
    vec2 out2 = normalize(toCenter * vec2(aspect, 1.0) + vec2(1e-6)) * u_halo;
    vec2 p = uv + out2 / vec2(aspect, 1.0);
    if (p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) {
      float w = pow(1.0 - min(length(0.5 - p) / CORNER, 1.0), 5.0);
      flare += vec3(
        texture(u_src, p - fringe).r,
        texture(u_src, p).g,
        texture(u_src, p + fringe).b
      ) * w;
    }
  }
  fragColor = vec4(flare, 1.0);`;

const AXIS = `  vec2 dir = (u_pass == 2) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  fragColor = glowAxis(u_src, v_uv, u_resolution, dir, u_blur * u_pixel_scale);`;

const COMBINE = `  vec4 base = texture(u_orig, v_uv);
  vec3 flare = texture(u_src, v_uv).rgb;
  fragColor = vec4(base.rgb + flare * u_intensity, base.a);`;

export const lensFlare: EffectDef = {
  id: 'lensFlare',
  label: 'Lens Flare',
  category: 'optics',
  animated: false,
  params: [
    { kind: 'float', key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.75 },
    { kind: 'float', key: 'knee', label: 'Knee', min: 0.001, max: 0.5, step: 0.005, default: 0.1 },
    { kind: 'int', key: 'ghosts', label: 'Ghosts', min: 1, max: 8, default: 4 },
    { kind: 'float', key: 'spacing', label: 'Spacing', min: 0.05, max: 0.8, step: 0.01, default: 0.35 },
    { kind: 'float', key: 'halo', label: 'Halo', min: 0, max: 0.8, step: 0.01, default: 0.4 },
    { kind: 'float', key: 'dispersion', label: 'Dispersion', min: 0, max: 30, step: 0.5, default: 6 },
    { kind: 'float', key: 'blur', label: 'Blur', min: 0, max: 32, step: 0.5, default: 6 },
    { kind: 'float', key: 'intensity', label: 'Intensity', min: 0, max: 4, step: 0.01, default: 1 },
  ],
  fragment: [THRESHOLD, GHOSTS, AXIS, AXIS, COMBINE],
};
