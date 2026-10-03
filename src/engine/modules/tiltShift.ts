import type { EffectDef } from '../effects';

/**
 * The miniature look: a band of sharp focus across the frame and blur that
 * grows away from it, the shallow depth of field of a lens tilted against
 * the sensor -- which is how a real street comes to look like a model.
 *
 * Focus places the band across the frame and Angle turns it; Width is how
 * much stays sharp either side of its centre line and Falloff how far the
 * blur takes to reach Max Blur. The radius is worked out per pixel in both
 * blur passes, so the band's own pixels are never blurred at all.
 *
 * Saturation adds the bright, painted colour of a toy model; at 1 it is off.
 */
const RADIUS = `  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  float a = radians(u_angle);
  // Signed distance from the band's centre line, across it, in units of
  // the frame's height so the band is the same width at any angle.
  vec2 p = (v_uv - 0.5) * vec2(aspect, 1.0);
  float across = dot(p, vec2(-sin(a), cos(a))) - (u_focus - 0.5);
  float blur = u_maxBlur * smoothstep(u_width, u_width + max(u_falloff, 0.001), abs(across));`;

const AXIS = `${RADIUS}
  vec2 dir = (u_pass == 0) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  fragColor = blurAxis(u_src, v_uv, u_resolution, dir, blur * u_pixel_scale);`;

const FINISH = `  vec4 c = texture(u_src, v_uv);
  c.rgb = sat(mix(vec3(luma(c.rgb)), c.rgb, u_saturation));
  fragColor = c;`;

export const tiltShift: EffectDef = {
  id: 'tiltShift',
  label: 'Tilt-Shift',
  category: 'optics',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'focus', label: 'Focus', min: 0, max: 1, step: 0.01, default: 0.5 },
    { kind: 'float', key: 'angle', label: 'Angle (°)', min: -90, max: 90, step: 1, default: 0 },
    { kind: 'float', key: 'width', label: 'Width', min: 0, max: 0.5, step: 0.005, default: 0.08 },
    { kind: 'float', key: 'falloff', label: 'Falloff', min: 0.01, max: 1, step: 0.01, default: 0.25 },
    { kind: 'float', key: 'maxBlur', label: 'Max Blur', min: 0, max: 48, step: 0.5, default: 12 },
    { kind: 'float', key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, default: 1.3 },
  ],
  fragment: [AXIS, AXIS, FINISH],
};
