import type { EffectDef } from '../effects';

/**
 * Dithering module featuring notorious ordered, blue-noise, clustered-dot,
 * and stochastic dithering algorithms for retro 1-bit Mac, Game Boy, VGA,
 * print halftone, and modern rendering aesthetics.
 *
 * Quantizes luminance or color channels against threshold patterns including
 * recursive Bayer matrices, clustered-dot print screens, Ulichney void-and-cluster
 * blue noise, Jimenez interleaved gradient noise (IGN), and stochastic noise.
 */
export const dither: EffectDef = {
  id: 'dither',
  label: 'Dither',
  category: 'stylize',
  animated: false,
  mixable: true,
  params: [
    {
      kind: 'enum',
      key: 'matrix',
      label: 'Pattern',
      options: [
        'Bayer 2x2',
        'Bayer 4x4',
        'Bayer 8x8',
        'Cluster Dot 4x4',
        'Cluster Dot 8x8',
        'Blue Noise',
        'IGN (Jimenez)',
        'White Noise',
        'Diagonal Lines',
        'Horizontal Lines',
        'Floyd-Steinberg',
        'Atkinson',
      ],
      default: 1,
    },
    { kind: 'float', key: 'scale', label: 'Pattern Scale', min: 1, max: 8, step: 1, default: 1 },
    { kind: 'int', key: 'levels', label: 'Color Levels', min: 2, max: 16, default: 2 },
    { kind: 'bool', key: 'monochrome', label: 'Monochrome', default: false },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float steps = float(max(u_levels - 1, 1));
  vec3 col;

  if (u_matrix >= 10) {
    // Error diffusion: Floyd-Steinberg (10) and Atkinson (11)
    ivec2 p = ivec2(max(floor((v_uv * u_resolution) / max(u_scale, 1.0)), vec2(0.0)));
    ivec2 cell = p & 3;
    ivec2 origin = p - cell;

    vec3 err[42];
    for (int i = 0; i < 42; i++) err[i] = vec3(0.0);

    // Initial boundary error seed to break block seams
    vec3 seed = vec3(hash12(vec2(origin) + vec2(u_seed * 17.0, u_seed * 43.0)) - 0.5) * (0.25 / steps);
    err[1] = seed;

    col = vec3(0.0);
    vec2 invRes = 1.0 / u_resolution;
    float scale = max(u_scale, 1.0);

    for (int py = 0; py < 4; py++) {
      for (int px = 0; px < 4; px++) {
        int idx = py * 7 + (px + 1);
        vec2 sampleUv = (vec2(origin + ivec2(px, py)) + 0.5) * scale * invRes;
        vec4 s = texture(u_src, clamp(sampleUv, 0.0, 1.0));
        vec3 raw = u_monochrome ? vec3(luma(s.rgb)) : s.rgb;
        vec3 val = raw + err[idx];
        vec3 q = clamp(floor(val * steps + 0.5) / steps, 0.0, 1.0);

        if (py == cell.y && px == cell.x) {
          col = q;
          break;
        }

        vec3 e = val - q;
        if (u_matrix == 10) {
          // Floyd-Steinberg: 7/16 right, 3/16 down-left, 5/16 down, 1/16 down-right
          err[py * 7 + (px + 2)] += e * (7.0 / 16.0);
          err[(py + 1) * 7 + px] += e * (3.0 / 16.0);
          err[(py + 1) * 7 + (px + 1)] += e * (5.0 / 16.0);
          err[(py + 1) * 7 + (px + 2)] += e * (1.0 / 16.0);
        } else {
          // Atkinson: 1/8 to 6 neighbors (retains 3/4 error, discards 1/4 for classic Mac contrast)
          e *= 0.125;
          err[py * 7 + (px + 2)] += e;
          err[py * 7 + (px + 3)] += e;
          err[(py + 1) * 7 + px] += e;
          err[(py + 1) * 7 + (px + 1)] += e;
          err[(py + 1) * 7 + (px + 2)] += e;
          err[(py + 2) * 7 + (px + 1)] += e;
        }
      }
      if (py == cell.y) break;
    }
  } else {
    ivec2 p = ivec2(max(floor((v_uv * u_resolution) / max(u_scale, 1.0)), vec2(0.0)));
    ivec2 p8 = p & 7;
    ivec2 p4 = p & 3;

    float threshold = 0.5;

    if (u_matrix == 0) {
      // Bayer 2x2: Bryce Bayer (1973) classic 2x2 dispersed-dot matrix
      int b2 = ((p.x & 1) ^ (p.y & 1)) * 2 + (p.y & 1);
      threshold = (float(b2) + 0.5) / 4.0;
    } else if (u_matrix == 1) {
      // Bayer 4x4: standard 4x4 ordered dither
      int b4 = 4 * (((p4.x & 1) ^ (p4.y & 1)) * 2 + (p4.y & 1)) + (((p4.x >> 1) ^ (p4.y >> 1)) * 2 + (p4.y >> 1));
      threshold = (float(b4) + 0.5) / 16.0;
    } else if (u_matrix == 2) {
      // Bayer 8x8: recursive 8x8 ordered dither for smooth cross-hatch stippling
      int b4 = 4 * (((p8.x & 1) ^ (p8.y & 1)) * 2 + (p8.y & 1)) + (((p8.x >> 1) ^ (p8.y >> 1)) * 2 + (p8.y >> 1));
      int b8 = 4 * b4 + (((p8.x >> 2) ^ (p8.y >> 2)) * 2 + (p8.y >> 2));
      threshold = (float(b8) + 0.5) / 64.0;
    } else if (u_matrix == 3) {
      // Cluster Dot 4x4: halftone screen with dots growing concentrically outward
      const int c4[16] = int[16](
        12,  5,  6, 13,
         4,  0,  1,  7,
        11,  3,  2,  8,
        15, 10,  9, 14
      );
      threshold = (float(c4[p4.y * 4 + p4.x]) + 0.5) / 16.0;
    } else if (u_matrix == 4) {
      // Cluster Dot 8x8: newspaper / lithographic printing screen with 45-degree clusters
      const int c8[64] = int[64](
        24, 10, 12, 26, 35, 47, 49, 37,
         8,  0,  2, 14, 45, 59, 61, 51,
        22,  6,  4, 16, 43, 57, 63, 53,
        30, 20, 18, 28, 33, 41, 55, 39,
        34, 46, 48, 36, 25, 11, 13, 27,
        44, 58, 60, 50,  9,  1,  3, 15,
        42, 56, 62, 52, 23,  7,  5, 17,
        32, 40, 54, 38, 31, 21, 19, 29
      );
      threshold = (float(c8[p8.y * 8 + p8.x]) + 0.5) / 64.0;
    } else if (u_matrix == 5) {
      // Blue Noise: Robert Ulichney (1993) void-and-cluster blue-noise dither array
      const int bn8[64] = int[64](
        12, 51,  8, 24, 47,  9, 20, 43,
        37, 27, 44, 17, 53, 39, 59,  5,
        48,  1, 57, 34, 13, 29, 25, 16,
        61, 19, 40,  6, 63,  2, 52, 32,
        45, 10, 31, 23, 46, 38, 22,  7,
        26, 55, 50, 14, 54, 11, 60, 42,
        15, 36,  4, 41, 28, 18, 35,  3,
        58, 21, 62, 33,  0, 56, 49, 30
      );
      threshold = (float(bn8[p8.y * 8 + p8.x]) + 0.5) / 64.0;
    } else if (u_matrix == 6) {
      // Interleaved Gradient Noise: Jorge Jimenez (Call of Duty / AAA real-time rendering)
      vec2 pf = vec2(p);
      threshold = fract(52.9829189 * fract(dot(pf, vec2(0.06711056, 0.00583715))));
    } else if (u_matrix == 7) {
      // White Noise: Lawrence Roberts (1962) random stochastic dithering
      threshold = hash12(vec2(p) + vec2(u_seed * 17.0, u_seed * 43.0));
    } else if (u_matrix == 8) {
      // Diagonal Lines: 45-degree line screen engraving
      threshold = (float((p.x + p.y) & 3) + 0.5) / 4.0;
    } else {
      // Horizontal Lines: 1D raster scanline screen
      threshold = (float(p.y & 3) + 0.5) / 4.0;
    }

    float offset = threshold - 0.5;
    vec3 base = u_monochrome ? vec3(luma(src.rgb)) : src.rgb;
    col = clamp(floor((base + offset / steps) * steps + 0.5) / steps, 0.0, 1.0);
  }

  fragColor = vec4(col, src.a);`,
};
