import type { EffectDef } from '../effects';

/**
 * Mosaic pixel grid with optional colour quantization.
 *
 * Samples texels on a stepped UV lattice. Aspect ratio is preserved so
 * cells remain square pixels rather than stretching to the image frame.
 */
export const pixelate: EffectDef = {
  id: 'pixelate',
  label: 'Pixelate',
  category: 'stylize',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'size', label: 'Pixel Size', min: 1, max: 64, step: 1, default: 8 },
    { kind: 'int', key: 'quantize', label: 'Color Depth', min: 0, max: 32, default: 0 },
  ],
  fragment: `  vec2 pixelSize = vec2(max(u_size, 1.0)) / u_resolution;
  vec2 gridUv = (floor(v_uv / pixelSize) + 0.5) * pixelSize;
  vec4 c = sampleEdge(u_src, gridUv, 0);

  if (u_quantize > 0) {
    float q = float(u_quantize);
    c.rgb = floor(c.rgb * q + 0.5) / q;
  }

  fragColor = c;`,
};
