import type { EffectDef } from '../effects';

/**
 * The picture broken into irregular cells -- a Voronoi diagram -- each
 * filled with the colour under its seed, like stained or cut glass.
 *
 * Seeds are jittered from a square grid, so Randomness at 0 is a plain
 * grid of squares and at 1 fully irregular cells. Speed sets them orbiting
 * their grid spot; it is phased, so changing it mid-play never jumps.
 *
 * The edge line is the exact distance to the border between the nearest
 * seed and its neighbours (the second pass), not the cheaper difference
 * of the two nearest distances, which draws lines of uneven width.
 */
export const crystalMosaic: EffectDef = {
  id: 'crystalMosaic',
  label: 'Crystal Mosaic',
  category: 'stylize',
  animated: (params) => params.speed !== 0,
  mixable: true,
  params: [
    { kind: 'float', key: 'cellSize', label: 'Cell Size', min: 4, max: 200, step: 1, default: 32 },
    { kind: 'float', key: 'randomness', label: 'Randomness', min: 0, max: 1, step: 0.01, default: 1 },
    { kind: 'float', key: 'facet', label: 'Facet', min: 0, max: 1, step: 0.01, default: 0 },
    { kind: 'float', key: 'edgeWidth', label: 'Edge Width', min: 0, max: 10, step: 0.1, default: 1 },
    { kind: 'color', key: 'edgeColor', label: 'Edge Color', default: [0.05, 0.05, 0.06] },
    { kind: 'float', key: 'speed', label: 'Speed', min: -4, max: 4, step: 0.01, default: 0 },
  ],
  fragment: `  float cellPx = max(u_cellSize * u_pixel_scale, 1.0);
  vec2 p = v_uv * u_resolution / cellPx;
  vec2 cell = floor(p);

  // Nearest seed.
  vec2 nearest = vec2(0.0);
  vec2 toNearest = vec2(0.0);
  float best = 1e9;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 id = cell + vec2(x, y);
      vec2 h = hash22(id + u_seed * 17.0);
      vec2 jitter = 0.5 * sin(u_phase_speed + 6.2831853 * h);
      vec2 r = id + 0.5 + jitter * u_randomness - p;
      float d = dot(r, r);
      if (d < best) {
        best = d;
        nearest = id;
        toNearest = r;
      }
    }
  }

  // Distance to the nearest border, measured across each bisector.
  float border = 1e9;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 id = nearest + vec2(x, y);
      vec2 h = hash22(id + u_seed * 17.0);
      vec2 jitter = 0.5 * sin(u_phase_speed + 6.2831853 * h);
      vec2 r = id + 0.5 + jitter * u_randomness - p;
      vec2 diff = r - toNearest;
      if (dot(diff, diff) > 1e-6) border = min(border, dot(0.5 * (toNearest + r), normalize(diff)));
    }
  }

  vec2 seedUv = (p + toNearest) * cellPx / u_resolution;
  vec4 src = texture(u_src, v_uv);
  vec3 c = texture(u_src, clamp(seedUv, 0.0, 1.0)).rgb;
  c *= 1.0 - u_facet * min(sqrt(best) * 1.2, 1.0);

  // Border distance is in cells; the width is in pixels, either side.
  float halfWidth = 0.5 * u_edgeWidth * u_pixel_scale / cellPx;
  float aa = 1.0 / cellPx;
  float edge = u_edgeWidth > 0.0 ? 1.0 - smoothstep(halfWidth, halfWidth + aa, border) : 0.0;
  fragColor = vec4(mix(c, u_edgeColor, edge), src.a);`,
};
