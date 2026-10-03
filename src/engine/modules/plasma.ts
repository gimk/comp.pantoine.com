import type { EffectDef } from '../effects';

/**
 * Plasma: sine waves across, down, diagonally and round a wandering
 * centre, summed and sent through a palette -- the demoscene classic.
 *
 * Complexity is how many of the four fields are summed; Warp bends each
 * field's coordinates by the ones before it, which turns straight bands
 * into liquid. Palettes are cosine palettes (a + b cos(TAU (c t + d))),
 * so they cycle without a seam and Shift slides along them.
 *
 * Every time term turns a whole number of times per unit of phase, so the
 * animation carries on seamlessly when the phase wraps.
 */
export const plasma: EffectDef = {
  id: 'plasma',
  label: 'Plasma',
  category: 'generator',
  animated: (params) => params.speed !== 0,
  params: [
    { kind: 'float', key: 'scale', label: 'Scale', min: 0.1, max: 10, step: 0.05, default: 1.5 },
    { kind: 'float', key: 'speed', label: 'Speed', min: -2, max: 2, step: 0.01, default: 0.1 },
    { kind: 'int', key: 'complexity', label: 'Complexity', min: 1, max: 4, default: 4 },
    { kind: 'float', key: 'warp', label: 'Warp', min: 0, max: 2, step: 0.01, default: 0.4 },
    {
      kind: 'enum',
      key: 'palette',
      label: 'Palette',
      options: ['Rainbow', 'Fire', 'Ocean', 'Neon', 'Mono'],
      default: 0,
    },
    { kind: 'float', key: 'shift', label: 'Shift', min: 0, max: 1, step: 0.01, default: 0 },
  ],
  fragment: `  const float TAU = 6.2831853;
  vec2 p = aspectUv(v_uv, u_resolution) * u_scale;
  float ph = u_phase_speed;
  int layers = int(clamp(float(u_complexity), 1.0, 4.0));

  float sum = 0.0;
  float v = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= layers) break;
    // Each field bends the coordinates the next one sees.
    p += u_warp * 0.15 * vec2(sin(TAU * v), cos(TAU * v));
    if (i == 0) v = sin(TAU * (p.x + ph));
    else if (i == 1) v = sin(TAU * (p.y * 0.8 - ph));
    else if (i == 2) v = sin(TAU * ((p.x + p.y) * 0.6 + 2.0 * ph));
    else {
      vec2 c = 0.5 * vec2(sin(TAU * ph), cos(TAU * ph));
      v = sin(TAU * (length(p - c) * 1.2 - ph));
    }
    sum += v;
  }
  float t = 0.5 + 0.5 * sum / float(layers) + u_shift;

  vec3 a = vec3(0.5);
  vec3 b = vec3(0.5);
  vec3 c = vec3(1.0);
  vec3 d = vec3(0.0, 0.33, 0.67);
  if (u_palette == 1) {
    a = vec3(0.5, 0.25, 0.05); b = vec3(0.5, 0.3, 0.1); d = vec3(0.0, 0.1, 0.2);
  } else if (u_palette == 2) {
    a = vec3(0.15, 0.4, 0.55); b = vec3(0.15, 0.3, 0.35); d = vec3(0.5, 0.55, 0.6);
  } else if (u_palette == 3) {
    c = vec3(1.0, 1.0, 0.5); d = vec3(0.8, 0.9, 0.3);
  }
  vec3 col = u_palette == 4 ? vec3(0.5 + 0.5 * cos(TAU * t)) : a + b * cos(TAU * (c * t + d));
  fragColor = vec4(sat(col), 1.0);`,
};
