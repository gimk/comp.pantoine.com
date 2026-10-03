import type { EffectDef } from '../effects';

/**
 * Geometric patterns in two colours: checkerboard, stripes, a grid of
 * lines, a grid of dots, or rings round the centre. For masks, test cards,
 * and fields that switch a knob on and off across the frame.
 *
 * Size is the pattern's period, in hundredths of the frame's height, so a
 * pattern keeps its look at any resolution. Width is the share of each
 * period the line, stripe or dot takes. Every edge is antialiased over one
 * pixel, so the pattern stays clean however small or turned.
 */
export const pattern: EffectDef = {
  id: 'pattern',
  label: 'Pattern',
  category: 'generator',
  animated: false,
  params: [
    {
      kind: 'enum',
      key: 'type',
      label: 'Type',
      options: ['Checker', 'Stripes', 'Grid', 'Dots', 'Rings'],
      default: 0,
    },
    { kind: 'float', key: 'size', label: 'Size', min: 1, max: 100, step: 0.5, default: 10 },
    {
      kind: 'float',
      key: 'width',
      label: 'Width',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      activeWhen: (params) => params.type !== 0,
    },
    { kind: 'float', key: 'rotation', label: 'Rotation (°)', min: -180, max: 180, step: 1, default: 0 },
    { kind: 'vec2', key: 'offset', label: 'Offset', min: -1, max: 1, step: 0.01, default: [0, 0] },
    { kind: 'color', key: 'colorA', label: 'Color A', default: [1, 1, 1] },
    { kind: 'color', key: 'colorB', label: 'Color B', default: [0, 0, 0] },
  ],
  fragment: `  vec2 p = aspectUv(v_uv, u_resolution);
  float a = radians(u_rotation);
  p = vec2(cos(a) * p.x + sin(a) * p.y, -sin(a) * p.x + cos(a) * p.y);
  // In periods from here on.
  p = p / max(u_size * 0.01, 0.0001) + u_offset;
  // One pixel, in periods: the width of every antialiased edge.
  float aa = max(fwidth(p.x), fwidth(p.y));
  float w = clamp(u_width, 0.0, 1.0);

  float inside;
  if (u_type == 0) {
    vec2 f = fract(p) - 0.5;
    // Signed distance to the nearest square's edge, its sign the parity.
    float edge = min(abs(f.x), abs(f.y));
    float parity = (f.x * f.y < 0.0) ? 1.0 : 0.0;
    float along = smoothstep(0.0, aa, edge);
    inside = mix(0.5, parity, along);
  } else if (u_type == 1) {
    float d = abs(fract(p.x) - 0.5);
    inside = 1.0 - smoothstep(0.5 * w - aa, 0.5 * w + aa, d);
  } else if (u_type == 2) {
    vec2 d = abs(fract(p) - 0.5);
    float edge = max(d.x, d.y);
    inside = smoothstep(0.5 - 0.5 * w - aa, 0.5 - 0.5 * w + aa, edge);
  } else if (u_type == 3) {
    float d = length(fract(p) - 0.5);
    inside = 1.0 - smoothstep(0.5 * w - aa, 0.5 * w + aa, d);
  } else {
    float r = length(p - u_offset);
    float d = abs(fract(r) - 0.5);
    inside = 1.0 - smoothstep(0.5 * w - aa, 0.5 * w + aa, d);
  }
  fragColor = vec4(mix(u_colorB, u_colorA, inside), 1.0);`,
};
