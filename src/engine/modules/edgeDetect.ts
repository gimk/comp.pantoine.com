import type { EffectDef } from '../effects';

/**
 * Sobel edge detector for technical line art, cyberpunk neon outlines, and sketch looks.
 *
 * Computes spatial image gradients using a 3x3 kernel. Can output pure monochrome lines,
 * colored neon outlines, or composite glowing edges directly back over the source.
 */
export const edgeDetect: EffectDef = {
  id: 'edgeDetect',
  label: 'Edge Detect',
  category: 'stylize',
  animated: false,
  mixable: true,
  params: [
    {
      kind: 'enum',
      key: 'mode',
      label: 'Mode',
      options: ['White on Black', 'Black on White', 'Neon Edge', 'Overlay'],
      default: 0,
    },
    { kind: 'float', key: 'sensitivity', label: 'Sensitivity', min: 0.1, max: 10, step: 0.1, default: 2.0 },
    { kind: 'float', key: 'thickness', label: 'Thickness', min: 0.5, max: 5, step: 0.1, default: 1.0 },
    { kind: 'color', key: 'edgeColor', label: 'Edge Color', default: [0.0, 1.0, 0.85] },
  ],
  fragment: `  vec2 d = vec2(max(u_thickness, 0.1)) / u_resolution;

  float tl = luma(texture(u_src, v_uv + vec2(-d.x, -d.y)).rgb);
  float tc = luma(texture(u_src, v_uv + vec2( 0.0, -d.y)).rgb);
  float tr = luma(texture(u_src, v_uv + vec2( d.x, -d.y)).rgb);
  float ml = luma(texture(u_src, v_uv + vec2(-d.x,  0.0)).rgb);
  float mr = luma(texture(u_src, v_uv + vec2( d.x,  0.0)).rgb);
  float bl = luma(texture(u_src, v_uv + vec2(-d.x,  d.y)).rgb);
  float bc = luma(texture(u_src, v_uv + vec2( 0.0,  d.y)).rgb);
  float br = luma(texture(u_src, v_uv + vec2( d.x,  d.y)).rgb);

  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
  float edge = clamp(length(vec2(gx, gy)) * u_sensitivity, 0.0, 1.0);

  vec4 src = texture(u_src, v_uv);
  vec3 col;
  if (u_mode == 0) col = vec3(edge);
  else if (u_mode == 1) col = vec3(1.0 - edge);
  else if (u_mode == 2) col = u_edgeColor * edge;
  else col = mix(src.rgb, u_edgeColor, edge);

  fragColor = vec4(col, src.a);`,
};
