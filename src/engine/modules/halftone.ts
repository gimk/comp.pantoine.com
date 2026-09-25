import type { EffectDef } from '../effects';

/**
 * Halftone dot screen for print reproduction, pop art, and comic books.
 *
 * Simulates ink rosettes and printing screens. Sizes dots proportionally
 * to local ink density, with adjustable dot frequency, angle, and softness.
 */
export const halftone: EffectDef = {
  id: 'halftone',
  label: 'Halftone',
  category: 'stylize',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'scale', label: 'Screen Frequency', min: 10, max: 120, step: 1, default: 45 },
    { kind: 'float', key: 'angle', label: 'Screen Angle', min: 0, max: 90, step: 1, default: 45 },
    { kind: 'float', key: 'softness', label: 'Dot Softness', min: 0.01, max: 0.5, step: 0.01, default: 0.1 },
    { kind: 'color', key: 'paper', label: 'Paper Color', default: [0.96, 0.94, 0.90] },
    { kind: 'color', key: 'ink', label: 'Ink Color', default: [0.08, 0.08, 0.1] },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = v_uv - 0.5;
  p.x *= aspect;

  float r = radians(u_angle);
  float s = sin(r);
  float c = cos(r);
  vec2 rot = vec2(p.x * c - p.y * s, p.x * s + p.y * c);

  vec2 grid = fract(rot * u_scale) - 0.5;
  float dist = length(grid);

  // Density: 0 for white paper, 1 for full ink
  float density = 1.0 - luma(src.rgb);
  // Maximum dot radius at diagonal corner is sqrt(0.5) ~ 0.7071
  float dotRadius = sqrt(clamp(density, 0.0, 1.0)) * 0.7071;

  float inkAmount = 1.0 - smoothstep(dotRadius - u_softness, dotRadius + u_softness, dist);
  vec3 col = mix(u_paper, u_ink, inkAmount);

  fragColor = vec4(col, src.a);`,
};
