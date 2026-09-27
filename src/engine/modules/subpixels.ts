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
  fragment: `  float size = max(u_size, 1.0);
  vec2 coord = v_uv * u_resolution;

  bool isBayer = (u_pattern == 3);
  bool isDelta = (u_pattern == 2);
  bool isBgr = (u_pattern == 1);

  // Sub-pixel dimensions (period of emitter repeat)
  float subW = isBayer ? (size * 0.5) : (size / 3.0);
  float subH = isBayer ? (size * 0.5) : size;

  // Stagger odd rows by 1.5 sub-pixels (half a pixel cell) for RGB Delta
  float row = floor(coord.y / size);
  float deltaStagger = (isDelta && mod(row, 2.0) >= 1.0) ? (1.5 * subW) : 0.0;

  float adjCoordX = coord.x - deltaStagger;

  // Pixelate: quantize sample UV to the parent pixel cell center
  vec2 sampleUv = v_uv;
  if (u_pixelate) {
    if (isDelta) {
      float cellX = floor(adjCoordX / size);
      sampleUv = vec2((cellX + 0.5) * size + deltaStagger, (row + 0.5) * size) / u_resolution;
    } else {
      vec2 cell = floor(coord / size);
      sampleUv = (cell + 0.5) * size / u_resolution;
    }
  }
  vec4 src = sampleEdge(u_src, sampleUv, 0);

  // Determine sub-pixel color emitter
  vec3 subColor;
  if (isBayer) {
    ivec2 bayerIdx = ivec2(mod(floor(coord / subW), 2.0));
    if (bayerIdx.x < 0) bayerIdx.x += 2;
    if (bayerIdx.y < 0) bayerIdx.y += 2;
    if (bayerIdx.y == 0) {
      subColor = (bayerIdx.x == 0) ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    } else {
      subColor = (bayerIdx.x == 0) ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
    }
  } else {
    int subIdx = int(mod(floor(adjCoordX / subW), 3.0));
    if (subIdx < 0) subIdx += 3;
    if (subIdx == 0) {
      subColor = vec3(1.0, 0.0, 0.0);
    } else if (subIdx == 1) {
      subColor = vec3(0.0, 1.0, 0.0);
    } else {
      subColor = vec3(0.0, 0.0, 1.0);
    }
    if (isBgr) {
      subColor = subColor.bgr;
    }
  }

  // Grid gaps & aperture
  float aperture = 1.0;
  if (u_gap > 0.0001) {
    float gapPx = clamp(u_gap, 0.0, 0.5) * subW;
    float halfGap = gapPx * 0.5;

    // Distance in pixels to the nearest grid line (continuous, no derivative jumps)
    float sx = adjCoordX / subW;
    float distX = abs(fract(sx + 0.5) - 0.5) * subW;

    float sy = coord.y / subH;
    float distY = abs(fract(sy + 0.5) - 0.5) * subH;

    // Anti-aliasing width in buffer pixels based on continuous coordinate derivatives
    float aaX = max(fwidth(coord.x) * 0.5, 0.25);
    float aaY = max(fwidth(coord.y) * 0.5, 0.25);

    float darkX = (1.0 - smoothstep(halfGap - aaX, halfGap + aaX, distX)) * min(gapPx / aaX, 1.0);
    float darkY = (1.0 - smoothstep(halfGap - aaY, halfGap + aaY, distY)) * min(gapPx / aaY, 1.0);

    aperture = (1.0 - darkX) * (1.0 - darkY);
  }

  vec3 channelMask = mix(vec3(u_bleed), vec3(1.0), subColor);
  vec3 light = channelMask * aperture + u_bleed * 0.1;
  fragColor = vec4(src.rgb * light * u_boost, src.a);`,
};
