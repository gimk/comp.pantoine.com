import type { EffectDef } from '../effects';

/**
 * Texture-driven displacement / optical refraction.
 *
 * Warps UV coordinates using another node's output as a surface heightmap or
 * vector field (e.g. frosted glass, liquid ripples, normal maps, or text cutouts).
 * An unplugged Map input passes the image through untouched.
 */
export const mapDisplace: EffectDef = {
  id: 'mapDisplace',
  label: 'Map Displace',
  category: 'geometry',
  animated: false,
  mixable: true,
  inputs: [{ key: 'map', label: 'Map' }],
  params: [
    { kind: 'float', key: 'amount', label: 'Amount', min: -0.2, max: 0.2, step: 0.001, default: 0.04 },
    {
      kind: 'enum',
      key: 'source',
      label: 'Vector Mode',
      options: ['Luma Gradient (Glass)', 'Red / Green Vector', 'Alpha Gradient'],
      default: 0,
    },
    { kind: 'enum', key: 'edge', label: 'Edge', options: ['Clamp', 'Wrap', 'Black', 'Mirror'], default: 0 },
  ],
  fragment: `  if (textureSize(u_map, 0).x <= 1) {
    fragColor = texture(u_src, v_uv);
  } else {
    vec2 offset;
    vec2 stepUv = 2.0 / u_resolution;

    if (u_source == 0) {
      // Surface slope / normal gradient for optical refraction
      float right = luma(texture(u_map, v_uv + vec2(stepUv.x, 0.0)).rgb);
      float left = luma(texture(u_map, v_uv - vec2(stepUv.x, 0.0)).rgb);
      float up = luma(texture(u_map, v_uv + vec2(0.0, stepUv.y)).rgb);
      float down = luma(texture(u_map, v_uv - vec2(0.0, stepUv.y)).rgb);
      offset = vec2(right - left, up - down) * u_amount * 5.0;
    } else if (u_source == 1) {
      // RG channels directly encode 2D displacement vectors centered at 0.5
      vec4 m = texture(u_map, v_uv);
      offset = (m.rg - 0.5) * u_amount;
    } else {
      float right = texture(u_map, v_uv + vec2(stepUv.x, 0.0)).a;
      float left = texture(u_map, v_uv - vec2(stepUv.x, 0.0)).a;
      float up = texture(u_map, v_uv + vec2(0.0, stepUv.y)).a;
      float down = texture(u_map, v_uv - vec2(0.0, stepUv.y)).a;
      offset = vec2(right - left, up - down) * u_amount * 5.0;
    }

    fragColor = sampleEdge(u_src, v_uv + offset, u_edge);
  }`,
};
