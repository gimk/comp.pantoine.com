import type { EffectDef } from '../effects';

/**
 * Relief: the picture's brightness read as height and lit from one side,
 * so edges facing the light rise and the ones facing away sink.
 *
 * The slope is the difference between two samples either side of the pixel
 * along the light's direction. Grey shows the relief alone, on mid grey;
 * Colour lights the picture with it; Overlay lays the grey relief over the
 * picture as an overlay blend, which keeps the colours and adds the bevel.
 */
export const emboss: EffectDef = {
  id: 'emboss',
  label: 'Emboss',
  category: 'stylize',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'angle', label: 'Angle (°)', min: 0, max: 360, step: 1, default: 135 },
    { kind: 'float', key: 'height', label: 'Height', min: 0, max: 10, step: 0.1, default: 2 },
    { kind: 'float', key: 'distance', label: 'Distance', min: 0.5, max: 16, step: 0.5, default: 1.5 },
    { kind: 'enum', key: 'mode', label: 'Mode', options: ['Grey', 'Colour', 'Overlay'], default: 0 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float a = radians(u_angle);
  vec2 d = vec2(cos(a), sin(a)) * max(u_distance * u_pixel_scale, 0.5) / u_resolution;
  float toward = luma(texture(u_src, v_uv + d).rgb);
  float away = luma(texture(u_src, v_uv - d).rgb);
  float relief = (toward - away) * u_height;

  vec3 c;
  if (u_mode == 0) {
    c = vec3(0.5 + relief);
  } else if (u_mode == 1) {
    c = src.rgb * (1.0 + relief);
  } else {
    float g = sat(0.5 + relief);
    vec3 b = src.rgb;
    c = mix(2.0 * b * g, 1.0 - 2.0 * (1.0 - b) * (1.0 - g), step(0.5, b));
  }
  fragColor = vec4(sat(c), src.a);`,
};
