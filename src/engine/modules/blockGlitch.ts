import type { EffectDef } from '../effects';

/**
 * MPEG macroblocking / compression glitch and datamosh tearing.
 *
 * Quantizes image into compression blocks and displaces random macroblocks
 * in discrete frame bursts with chromatic channel separation.
 */
export const blockGlitch: EffectDef = {
  id: 'blockGlitch',
  label: 'Block Glitch',
  category: 'tape',
  animated: (params) => params.speed !== 0 && params.intensity !== 0,
  mixable: true,
  params: [
    { kind: 'float', key: 'blockSize', label: 'Block Size', min: 8, max: 64, step: 2, default: 24 },
    { kind: 'float', key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.4 },
    { kind: 'float', key: 'colorShift', label: 'Color Drift', min: 0, max: 1, step: 0.01, default: 0.3 },
    { kind: 'float', key: 'speed', label: 'Speed', min: -2, max: 2, step: 0.05, default: 0.6 },
  ],
  fragment: `  vec2 blockUv = floor(v_uv * u_resolution / max(u_blockSize, 2.0));
  float t = floor(u_time * u_speed * 12.0);
  float seedVal = u_seed * 43.17 + t * 0.173;

  float blockNoise = hash12(blockUv + seedVal);
  vec2 displace = vec2(0.0);

  if (blockNoise < u_intensity * 0.35) {
    vec2 dir = hash22(blockUv + seedVal) - 0.5;
    displace = dir * (u_intensity * 0.08);
  }

  vec2 uv = clamp(v_uv + displace, 0.0, 1.0);
  vec4 col = texture(u_src, uv);

  if (u_colorShift > 0.0 && blockNoise < u_intensity * 0.35) {
    vec2 chromaOffset = vec2(u_colorShift * 0.015, 0.0);
    col.r = texture(u_src, clamp(uv + chromaOffset, 0.0, 1.0)).r;
    col.b = texture(u_src, clamp(uv - chromaOffset, 0.0, 1.0)).b;
  }

  fragColor = col;`,
};
