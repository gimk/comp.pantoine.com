import type { EffectDef } from '../effects';

/**
 * Cut the picture away where a noise-perturbed brightness falls below a
 * level, leaving a hot rim along the cut.
 *
 * The rim is part of this module rather than a separate one on purpose. A
 * standalone rim module would have to recompute the same threshold from the
 * same noise with the same seed just to find out where the edge was -- the
 * edge is a property of the cut, so it lives with the cut.
 *
 * Cutting alpha rather than painting black means the burn eats through to
 * whatever is behind, which is what makes it read as a hole rather than a
 * stain.
 */
export const threshold: EffectDef = {
  id: 'threshold',
  label: 'Threshold',
  category: 'color',
  animated: (params) => params.speed !== 0,
  params: [
    { kind: 'float', key: 'level', label: 'Level', min: 0, max: 1, step: 0.01, default: 0.5 },
    { kind: 'float', key: 'softness', label: 'Softness', min: 0.001, max: 0.5, step: 0.005, default: 0.05 },
    { kind: 'float', key: 'noise', label: 'Noise', min: 0, max: 1, step: 0.01, default: 0.8 },
    { kind: 'float', key: 'scale', label: 'Noise Scale', min: 0.5, max: 40, step: 0.5, default: 6 },
    { kind: 'int', key: 'octaves', label: 'Octaves', min: 1, max: 8, default: 4 },
    { kind: 'float', key: 'speed', label: 'Speed', min: -2, max: 2, step: 0.01, default: 0 },
    { kind: 'color', key: 'rim', label: 'Rim', default: [1, 0.55, 0.12] },
    { kind: 'float', key: 'rimWidth', label: 'Rim Width', min: 0, max: 0.5, step: 0.005, default: 0.08 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  vec2 field = v_uv * u_scale + u_seed * 53.0;
  float n = fbm(field + vec2(u_time * u_speed, 0.0), u_octaves);

  // Brightness blended towards the noise, so at Noise 0 this is a plain
  // luma key and at 1 it is pure fractal burn-through.
  float control = mix(luma(src.rgb), n, u_noise);

  float keep = smoothstep(u_level - u_softness, u_level + u_softness, control);
  // The rim is the band just above the cut, brightest right at the edge.
  float edge = keep * (1.0 - smoothstep(0.0, max(u_rimWidth, 0.0001), control - u_level));

  fragColor = vec4(mix(src.rgb, u_rim, edge), src.a * keep);`,
};
