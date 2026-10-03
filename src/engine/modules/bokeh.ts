import type { EffectDef } from '../effects';

/**
 * Lens blur: out of focus the way a lens is, where a bright point spreads
 * into the shape of the aperture -- a disc, or the polygon of its blades --
 * instead of a soft Gaussian smudge.
 *
 * The taps lie on a golden-angle spiral, which covers a disc evenly with no
 * rings or spokes for the eye to catch. For a polygon each tap is pushed
 * out to where the polygon's edge is at its angle, so the same taps fill
 * a hexagon or an octagon instead. One pass of a fixed tap count: the
 * radius spreads them out, it never adds to the cost.
 *
 * A plain average lets a bright point be swamped by its dark surroundings.
 * Highlight Boost weighs bright taps more, so lights come out as crisp,
 * bright shapes -- the look the module is for.
 */
export const bokeh: EffectDef = {
  id: 'bokeh',
  label: 'Bokeh',
  category: 'optics',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'radius', label: 'Radius', min: 0, max: 48, step: 0.5, default: 10 },
    { kind: 'enum', key: 'shape', label: 'Shape', options: ['Disc', 'Hexagon', 'Octagon'], default: 0 },
    {
      kind: 'float',
      key: 'rotation',
      label: 'Rotation (°)',
      min: 0,
      max: 90,
      step: 1,
      default: 0,
      activeWhen: (params) => params.shape !== 0,
    },
    { kind: 'float', key: 'boost', label: 'Highlight Boost', min: 0, max: 4, step: 0.01, default: 1.5 },
    { kind: 'float', key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.6 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float radius = u_radius * u_pixel_scale;
  if (radius < 0.5) {
    fragColor = src;
  } else {
    const int TAPS = 96;
    const float GOLDEN = 2.39996323;
    float sides = u_shape == 1 ? 6.0 : 8.0;
    float wedge = 6.2831853 / sides;
    float rot = radians(u_rotation);
    vec2 px = radius / u_resolution;

    vec4 sum = vec4(0.0);
    float total = 0.0;
    for (int i = 0; i < TAPS; i++) {
      float r = sqrt((float(i) + 0.5) / float(TAPS));
      float theta = float(i) * GOLDEN;
      if (u_shape != 0) {
        // Distance to the polygon's edge at this angle, the circumradius
        // being 1: cos(pi/n) over the cosine of the angle off the nearest
        // edge's middle.
        float off = mod(theta - rot, wedge) - 0.5 * wedge;
        r *= cos(0.5 * wedge) / cos(off);
      }
      vec2 p = v_uv + vec2(cos(theta), sin(theta)) * r * px;
      vec4 c = texture(u_src, clamp(p, 0.0, 1.0));
      float w = 1.0 + u_boost * smoothstep(u_threshold, 1.0, luma(c.rgb));
      sum += c * w;
      total += w;
    }
    fragColor = sum / total;
  }`,
};
