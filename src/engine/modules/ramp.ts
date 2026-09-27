import type { EffectDef } from '../effects';

export const ramp: EffectDef = {
  id: 'ramp',
  label: 'Ramp',
  category: 'generator',
  animated: false,
  params: [
    {
      kind: 'enum',
      key: 'type',
      label: 'Type',
      options: ['Linear', 'Radial', 'Angle', 'Diamond'],
      default: 0,
    },
    {
      kind: 'float',
      key: 'angle',
      label: 'Angle',
      min: 0,
      max: 360,
      step: 1,
      default: 0,
    },
    {
      kind: 'enum',
      key: 'interpolation',
      label: 'Interpolation',
      options: ['Linear', 'Smooth', 'Step'],
      default: 1,
    },
    {
      kind: 'enum',
      key: 'extend',
      label: 'Extend',
      options: ['Clamp', 'Repeat', 'Mirror'],
      default: 0,
    },
    {
      kind: 'int',
      key: 'stopCount',
      label: 'Stops',
      min: 2,
      max: 8,
      default: 3,
    },
    { kind: 'float', key: 'pos0', label: 'Pos 1', min: 0, max: 1, step: 0.01, default: 0.0 },
    { kind: 'color', key: 'color0', label: 'Color 1', default: [0.06, 0.05, 0.18] },
    { kind: 'float', key: 'pos1', label: 'Pos 2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { kind: 'color', key: 'color1', label: 'Color 2', default: [0.92, 0.22, 0.54] },
    { kind: 'float', key: 'pos2', label: 'Pos 3', min: 0, max: 1, step: 0.01, default: 1.0 },
    { kind: 'color', key: 'color2', label: 'Color 3', default: [0.98, 0.78, 0.25] },
    { kind: 'float', key: 'pos3', label: 'Pos 4', min: 0, max: 1, step: 0.01, default: 1.0 },
    { kind: 'color', key: 'color3', label: 'Color 4', default: [0.2, 0.8, 0.9] },
    { kind: 'float', key: 'pos4', label: 'Pos 5', min: 0, max: 1, step: 0.01, default: 1.0 },
    { kind: 'color', key: 'color4', label: 'Color 5', default: [1.0, 1.0, 1.0] },
    { kind: 'float', key: 'pos5', label: 'Pos 6', min: 0, max: 1, step: 0.01, default: 1.0 },
    { kind: 'color', key: 'color5', label: 'Color 6', default: [0.5, 0.5, 0.5] },
    { kind: 'float', key: 'pos6', label: 'Pos 7', min: 0, max: 1, step: 0.01, default: 1.0 },
    { kind: 'color', key: 'color6', label: 'Color 7', default: [0.3, 0.3, 0.3] },
    { kind: 'float', key: 'pos7', label: 'Pos 8', min: 0, max: 1, step: 0.01, default: 1.0 },
    { kind: 'color', key: 'color7', label: 'Color 8', default: [0.1, 0.1, 0.1] },
  ],
  fragment: `
  float t = 0.0;
  if (u_type == 0) {
    // Linear gradient with angle
    float rad = radians(u_angle);
    vec2 dir = vec2(cos(rad), sin(rad));
    t = dot(v_uv - 0.5, dir) + 0.5;
  } else if (u_type == 1) {
    // Radial gradient from center
    vec2 p = aspectUv(v_uv, u_resolution);
    t = length(p) * 2.0;
  } else if (u_type == 2) {
    // Conic/Angle sweep gradient
    vec2 p = aspectUv(v_uv, u_resolution);
    t = (atan(p.y, p.x) / TAU) + 0.5;
    t = fract(t + u_angle / 360.0);
  } else if (u_type == 3) {
    // Diamond gradient
    vec2 p = abs(aspectUv(v_uv, u_resolution));
    t = (p.x + p.y) * 2.0;
  }

  // Extend mode
  if (u_extend == 0) {
    t = sat(t);
  } else if (u_extend == 1) {
    t = fract(t);
  } else if (u_extend == 2) {
    t = abs(fract(t * 0.5) * 2.0 - 1.0);
  }

  // Multi-stop color evaluation (2 to 8 stops)
  vec3 col = u_color0;
  if (t <= u_pos0) {
    col = u_color0;
  } else if (u_stopCount >= 2 && t <= u_pos1) {
    float span = max(u_pos1 - u_pos0, 0.0001);
    float u = sat((t - u_pos0) / span);
    if (u_interpolation == 1) u = smoothstep(0.0, 1.0, u);
    else if (u_interpolation == 2) u = step(0.5, u);
    col = mix(u_color0, u_color1, u);
  } else if (u_stopCount >= 3 && t <= u_pos2) {
    float span = max(u_pos2 - u_pos1, 0.0001);
    float u = sat((t - u_pos1) / span);
    if (u_interpolation == 1) u = smoothstep(0.0, 1.0, u);
    else if (u_interpolation == 2) u = step(0.5, u);
    col = mix(u_color1, u_color2, u);
  } else if (u_stopCount >= 4 && t <= u_pos3) {
    float span = max(u_pos3 - u_pos2, 0.0001);
    float u = sat((t - u_pos2) / span);
    if (u_interpolation == 1) u = smoothstep(0.0, 1.0, u);
    else if (u_interpolation == 2) u = step(0.5, u);
    col = mix(u_color2, u_color3, u);
  } else if (u_stopCount >= 5 && t <= u_pos4) {
    float span = max(u_pos4 - u_pos3, 0.0001);
    float u = sat((t - u_pos3) / span);
    if (u_interpolation == 1) u = smoothstep(0.0, 1.0, u);
    else if (u_interpolation == 2) u = step(0.5, u);
    col = mix(u_color3, u_color4, u);
  } else if (u_stopCount >= 6 && t <= u_pos5) {
    float span = max(u_pos5 - u_pos4, 0.0001);
    float u = sat((t - u_pos4) / span);
    if (u_interpolation == 1) u = smoothstep(0.0, 1.0, u);
    else if (u_interpolation == 2) u = step(0.5, u);
    col = mix(u_color4, u_color5, u);
  } else if (u_stopCount >= 7 && t <= u_pos6) {
    float span = max(u_pos6 - u_pos5, 0.0001);
    float u = sat((t - u_pos5) / span);
    if (u_interpolation == 1) u = smoothstep(0.0, 1.0, u);
    else if (u_interpolation == 2) u = step(0.5, u);
    col = mix(u_color5, u_color6, u);
  } else if (u_stopCount >= 8 && t <= u_pos7) {
    float span = max(u_pos7 - u_pos6, 0.0001);
    float u = sat((t - u_pos6) / span);
    if (u_interpolation == 1) u = smoothstep(0.0, 1.0, u);
    else if (u_interpolation == 2) u = step(0.5, u);
    col = mix(u_color6, u_color7, u);
  } else {
    // Past the last active stop
    if (u_stopCount == 2) col = u_color1;
    else if (u_stopCount == 3) col = u_color2;
    else if (u_stopCount == 4) col = u_color3;
    else if (u_stopCount == 5) col = u_color4;
    else if (u_stopCount == 6) col = u_color5;
    else if (u_stopCount == 7) col = u_color6;
    else col = u_color7;
  }

  fragColor = vec4(col, 1.0);
  `,
};
