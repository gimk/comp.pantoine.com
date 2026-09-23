import type { EffectDef } from '../effects';

/**
 * Two pictures into one: the main input is the base, the Layer input goes
 * on top.
 *
 * The first module with a second input, and the reason the renderer runs a
 * graph rather than a chain. The layer is fitted to the base's frame before
 * it gets here -- cropped to cover, not squashed -- so the two always line
 * up pixel for pixel.
 *
 * The modes work on straight RGB and are the usual formulas, chosen for
 * what they are for in this tool: Screen and Add to lay glow or light
 * leaks over a picture, Multiply for dirt and burn, Overlay and Soft light
 * for texture, Difference for lining two versions up.
 *
 * The layer's own alpha scales the result, and Mix sits on top as opacity.
 * With nothing on the Layer input it samples as transparent, so an
 * unplugged Blend passes the base through untouched.
 */
export const blend: EffectDef = {
  id: 'blend',
  label: 'Blend',
  category: 'composite',
  animated: false,
  mixable: true,
  inputs: [{ key: 'layer', label: 'Layer' }],
  params: [
    {
      kind: 'enum',
      key: 'mode',
      label: 'Mode',
      options: [
        'Normal',
        'Add',
        'Subtract',
        'Multiply',
        'Screen',
        'Overlay',
        'Soft light',
        'Difference',
        'Lighten',
        'Darken',
      ],
      default: 4,
    },
  ],
  fragment: `  vec4 base = texture(u_src, v_uv);
  vec4 top = texture(u_layer, v_uv);
  vec3 b = base.rgb;
  vec3 l = top.rgb;
  vec3 c;

  if (u_mode == 0) c = l;
  else if (u_mode == 1) c = b + l;
  else if (u_mode == 2) c = b - l;
  else if (u_mode == 3) c = b * l;
  else if (u_mode == 4) c = 1.0 - (1.0 - b) * (1.0 - l);
  // Overlay: multiply the darks, screen the lights, split on the base.
  else if (u_mode == 5) c = mix(2.0 * b * l, 1.0 - 2.0 * (1.0 - b) * (1.0 - l), step(0.5, b));
  // Soft light, the Pegtop form: continuous, with no seam at mid grey.
  else if (u_mode == 6) c = (1.0 - 2.0 * l) * b * b + 2.0 * l * b;
  else if (u_mode == 7) c = abs(b - l);
  else if (u_mode == 8) c = max(b, l);
  else c = min(b, l);

  fragColor = vec4(mix(b, clamp(c, 0.0, 1.0), top.a), base.a);`,
};
