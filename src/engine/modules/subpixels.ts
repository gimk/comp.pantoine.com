import type { EffectDef } from '../effects';

/**
 * Screen sub-pixel simulation for LCD, OLED, and retro handheld displays.
 *
 * Divides each pixel cell into physical red, green, and blue sub-pixel
 * emitters separated by a dark matrix grid.
 *
 * Supports standard RGB and BGR vertical stripes, staggered RGB Delta triads,
 * and 2x2 Bayer grids. When Pixelate is active, the image is quantized to
 * physical screen cells so each sub-pixel samples from its parent pixel.
 */
export const subpixels: EffectDef = {
  id: 'subpixels',
  label: 'Sub-pixels',
  category: 'crt',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'size', label: 'Pixel Size', min: 1, max: 48, step: 0.5, default: 6 },
    {
      kind: 'enum',
      key: 'pattern',
      label: 'Pattern',
      options: ['RGB Stripe', 'BGR Stripe', 'RGB Delta', 'Bayer Grid'],
      default: 0,
    },
    { kind: 'float', key: 'gap', label: 'Gap', min: 0, max: 0.5, step: 0.01, default: 0.15 },
    { kind: 'float', key: 'bleed', label: 'Bleed', min: 0, max: 0.5, step: 0.01, default: 0.1 },
    { kind: 'float', key: 'boost', label: 'Brightness', min: 1, max: 3, step: 0.05, default: 1.8 },
    { kind: 'bool', key: 'pixelate', label: 'Pixelate', default: true },
  ],
  fragment: `  vec2 cellSize = vec2(max(u_size, 1.0)) / u_resolution;
  vec2 px = v_uv * u_resolution / max(u_size, 1.0);
  vec2 cell = floor(px);
  vec2 f = fract(px);

  vec2 cellOffset = vec2(0.0);
  if (u_pattern == 2 && mod(cell.y, 2.0) >= 1.0) {
    f.x = fract(f.x + 0.5);
    cellOffset.x = 0.5;
  }

  vec2 sampleUv = u_pixelate ? (cell + cellOffset + 0.5) * cellSize : v_uv;
  vec4 src = sampleEdge(u_src, sampleUv, 0);

  float gapHalf = clamp(u_gap, 0.0, 0.45) * 0.5;
  vec3 subColor;
  float aperture;

  if (u_pattern == 3) {
    vec2 gridPos = f * 2.0;
    vec2 bayerIdx = floor(gridPos);
    vec2 bayerFrac = fract(gridPos);

    float edgeX = max(fwidth(gridPos.x), 0.01);
    float edgeY = max(fwidth(gridPos.y), 0.01);
    float maskX = smoothstep(0.0, edgeX, bayerFrac.x - gapHalf) *
                  smoothstep(0.0, edgeX, (1.0 - gapHalf) - bayerFrac.x);
    float maskY = smoothstep(0.0, edgeY, bayerFrac.y - gapHalf) *
                  smoothstep(0.0, edgeY, (1.0 - gapHalf) - bayerFrac.y);
    aperture = maskX * maskY;

    if (bayerIdx.y < 1.0) {
      subColor = (bayerIdx.x < 1.0) ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    } else {
      subColor = (bayerIdx.x < 1.0) ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
    }
  } else {
    float sub = f.x * 3.0;
    float subIdx = floor(sub);
    float subFrac = fract(sub);

    float edgeX = max(fwidth(sub), 0.01);
    float edgeY = max(fwidth(f.y), 0.01);
    float maskX = smoothstep(0.0, edgeX, subFrac - gapHalf) *
                  smoothstep(0.0, edgeX, (1.0 - gapHalf) - subFrac);
    float maskY = smoothstep(0.0, edgeY, f.y - gapHalf) *
                  smoothstep(0.0, edgeY, (1.0 - gapHalf) - f.y);
    aperture = maskX * maskY;

    if (subIdx < 1.0) {
      subColor = vec3(1.0, 0.0, 0.0);
    } else if (subIdx < 2.0) {
      subColor = vec3(0.0, 1.0, 0.0);
    } else {
      subColor = vec3(0.0, 0.0, 1.0);
    }

    if (u_pattern == 1) {
      subColor = subColor.bgr;
    }
  }

  vec3 channelMask = mix(vec3(u_bleed), vec3(1.0), subColor);
  vec3 light = channelMask * aperture + u_bleed * 0.1;
  fragColor = vec4(src.rgb * light * u_boost, src.a);`,
};
