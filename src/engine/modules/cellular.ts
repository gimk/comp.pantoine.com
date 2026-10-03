import type { EffectDef } from '../effects';

/**
 * Cells of a Voronoi diagram, drawn four ways: each cell one flat random
 * value (or colour), the distance to the nearest seed, lines along the
 * borders, or crackle -- the gap between the nearest two seeds, which
 * reads as cracked earth or scales.
 *
 * Flat is the one to wire into a diamond port: every pixel of a cell holds
 * the same value, so a knob takes one setting per cell. Seeds are
 * jittered from a grid by Randomness and orbit their spot at Speed, which
 * is phased. The borders are measured exactly, as Crystal Mosaic's are,
 * so Edges draws lines of one width all round.
 */
export const cellular: EffectDef = {
  id: 'cellular',
  label: 'Cellular',
  category: 'generator',
  animated: (params) => params.speed !== 0,
  params: [
    { kind: 'enum', key: 'mode', label: 'Mode', options: ['Flat', 'Distance', 'Edges', 'Crackle'], default: 0 },
    { kind: 'float', key: 'cellSize', label: 'Cell Size', min: 1, max: 50, step: 0.5, default: 8 },
    { kind: 'float', key: 'randomness', label: 'Randomness', min: 0, max: 1, step: 0.01, default: 1 },
    {
      kind: 'bool',
      key: 'colour',
      label: 'Colour',
      default: false,
      activeWhen: (params) => params.mode === 0,
    },
    {
      kind: 'float',
      key: 'edgeWidth',
      label: 'Edge Width',
      min: 0.01,
      max: 0.5,
      step: 0.005,
      default: 0.05,
      activeWhen: (params) => params.mode === 2,
    },
    { kind: 'float', key: 'speed', label: 'Speed', min: -4, max: 4, step: 0.01, default: 0 },
  ],
  fragment: `  // In cells: Cell Size is in hundredths of the frame's height.
  vec2 p = aspectUv(v_uv, u_resolution) / max(u_cellSize * 0.01, 0.0001);
  vec2 cell = floor(p);

  vec2 nearest = vec2(0.0);
  vec2 toNearest = vec2(0.0);
  float first = 1e9;
  float second = 1e9;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 id = cell + vec2(x, y);
      vec2 h = hash22(id + u_seed * 17.0);
      vec2 r = id + 0.5 + 0.5 * sin(u_phase_speed * 6.2831853 + 6.2831853 * h) * u_randomness - p;
      float d = dot(r, r);
      if (d < first) {
        second = first;
        first = d;
        nearest = id;
        toNearest = r;
      } else if (d < second) {
        second = d;
      }
    }
  }

  vec3 col;
  if (u_mode == 0) {
    vec2 key = nearest + u_seed * 17.0;
    col = u_colour
      ? vec3(hash12(key), hash12(key + 31.7), hash12(key + 67.3))
      : vec3(hash12(key));
  } else if (u_mode == 1) {
    col = vec3(sat(sqrt(first)));
  } else if (u_mode == 3) {
    col = vec3(sat(sqrt(second) - sqrt(first)));
  } else {
    float border = 1e9;
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 id = nearest + vec2(x, y);
        vec2 h = hash22(id + u_seed * 17.0);
        vec2 r = id + 0.5 + 0.5 * sin(u_phase_speed * 6.2831853 + 6.2831853 * h) * u_randomness - p;
        vec2 diff = r - toNearest;
        if (dot(diff, diff) > 1e-6) border = min(border, dot(0.5 * (toNearest + r), normalize(diff)));
      }
    }
    float aa = fwidth(p.x);
    col = vec3(1.0 - smoothstep(0.5 * u_edgeWidth, 0.5 * u_edgeWidth + aa, border));
  }
  fragColor = vec4(col, 1.0);`,
};
