import type { EffectDef } from '../effects';

/**
 * Mosaic pixel grid with optional colour quantization.
 *
 * Each cell is filled with the colour at its centre. The grid is laid out
 * in pixels, so cells keep their shape whatever the frame's aspect.
 *
 * Shapes: square cells; hexagons (pointy-top, Pixel Size across the
 * flats); triangles, each square split along a diagonal that alternates
 * cell to cell so they tile as a lattice; and dots, a disc per square cell
 * on the Background colour.
 */
export const pixelate: EffectDef = {
  id: 'pixelate',
  label: 'Pixelate',
  category: 'stylize',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'size', label: 'Pixel Size', min: 1, max: 64, step: 1, default: 8 },
    { kind: 'enum', key: 'shape', label: 'Shape', options: ['Square', 'Hex', 'Triangle', 'Dots'], default: 0 },
    { kind: 'int', key: 'quantize', label: 'Color Depth', min: 0, max: 32, default: 0 },
    {
      kind: 'color',
      key: 'background',
      label: 'Background',
      default: [0, 0, 0],
      activeWhen: (params) => params.shape === 3,
    },
  ],
  fragment: `  float s = max(u_size * u_pixel_scale, 1.0);
  vec2 q = v_uv * u_resolution;
  vec2 center;

  if (u_shape == 1) {
    // Pointy-top hexagons, s across the flats: axial coordinates rounded
    // to the nearest hexagon through cube coordinates.
    float r = s / sqrt(3.0);
    vec3 cube = vec3((sqrt(3.0) / 3.0 * q.x - q.y / 3.0) / r, 0.0, (2.0 / 3.0 * q.y) / r);
    cube.y = -cube.x - cube.z;
    vec3 rounded = floor(cube + 0.5);
    vec3 diff = abs(rounded - cube);
    if (diff.x > diff.y && diff.x > diff.z) rounded.x = -rounded.y - rounded.z;
    else if (diff.y > diff.z) rounded.y = -rounded.x - rounded.z;
    else rounded.z = -rounded.x - rounded.y;
    center = vec2(r * sqrt(3.0) * (rounded.x + rounded.z * 0.5), r * 1.5 * rounded.z);
  } else if (u_shape == 2) {
    vec2 cell = floor(q / s);
    vec2 f = q / s - cell;
    vec2 middle;
    if (mod(cell.x + cell.y, 2.0) < 0.5) {
      middle = f.x > f.y ? vec2(2.0, 1.0) / 3.0 : vec2(1.0, 2.0) / 3.0;
    } else {
      middle = f.x + f.y < 1.0 ? vec2(1.0) / 3.0 : vec2(2.0) / 3.0;
    }
    center = (cell + middle) * s;
  } else {
    center = (floor(q / s) + 0.5) * s;
  }

  vec4 c = sampleEdge(u_src, center / u_resolution, 0);

  if (u_quantize > 0) {
    float levels = float(u_quantize);
    c.rgb = floor(c.rgb * levels + 0.5) / levels;
  }

  if (u_shape == 3) {
    float radius = 0.5 * s;
    float inside = 1.0 - smoothstep(radius - 1.0, radius, length(q - center));
    c.rgb = mix(u_background, c.rgb, inside);
  }

  fragColor = c;`,
};
