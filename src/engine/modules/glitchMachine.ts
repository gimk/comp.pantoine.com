import type { EffectDef } from '../effects';

/**
 * Digital and Datamosh Glitch Synthesizer.
 *
 * Rhythmic burst engine driving macroblock compression shearing, predictive motion
 * tearing, channel permutation / solarization, and bitcrush downsampling.
 */
export const glitchMachine: EffectDef = {
  id: 'glitchMachine',
  label: 'Glitch Machine',
  category: 'tape',
  animated: (params) => params.rate !== 0 && params.intensity !== 0,
  mixable: true,
  params: [
    { kind: 'float', key: 'rate', label: 'Burst Rate', min: 0, max: 5, step: 0.05, default: 1.5 },
    { kind: 'float', key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.6 },
    { kind: 'float', key: 'blockSize', label: 'Block Size', min: 4, max: 64, step: 2, default: 16 },
    { kind: 'float', key: 'shearing', label: 'Shearing', min: 0, max: 1, step: 0.01, default: 0.5 },
    { kind: 'float', key: 'colorCorrupt', label: 'Color Corrupt', min: 0, max: 1, step: 0.01, default: 0.4 },
    { kind: 'float', key: 'bitcrush', label: 'Bitcrush', min: 0, max: 1, step: 0.01, default: 0.3 },
    { kind: 'float', key: 'pattern', label: 'Pattern', min: 0, max: 1, step: 0.01, default: 0.0 },
  ],
  fragment: `
  // Rhythmic temporal burst envelope
  float burstClock = u_phase_rate * 5.0;
  float burstStep = floor(burstClock);
  float burstFrac = fract(burstClock);
  float burstNoise = hash12(vec2(burstStep, u_pattern * 37.13 + u_seed * 19.31));

  // Sharp burst threshold with exponential decay
  float burstActive = step(1.0 - u_intensity * 0.75, burstNoise);
  float burstEnv = burstActive * exp(-burstFrac * 3.2);

  // Macroblock coordinate space
  float bSize = max(u_blockSize * u_pixel_scale, 1.0);
  vec2 blockCoord = floor(v_uv * u_resolution / bSize);
  float blockHash = hash12(blockCoord + vec2(burstStep * 29.3, u_pattern * 47.9 + u_seed * 11.7));

  // Determine if this block is corrupted in the burst
  float glitchProb = u_intensity * burstEnv * 1.6;
  bool isCorrupt = (blockHash < glitchProb);

  // Datamosh & Macroblock Shearing
  vec2 displace = vec2(0.0);
  if (isCorrupt) {
    vec2 shearDir = (hash22(blockCoord + vec2(burstStep * 17.1, burstStep * 31.7)) - 0.5) * 2.0;
    // Quantize shear to macroblock steps for authentic compression tearing
    displace = shearDir * (u_shearing * 0.18);
  }

  vec2 uv = clamp(v_uv + displace, 0.0, 1.0);

  // Spatial bitcrush / downsampling inside corrupted blocks
  if (u_bitcrush > 0.0 && isCorrupt) {
    float crushGrid = max(mix(1.0, 16.0, u_bitcrush) * u_pixel_scale, 0.5);
    uv = floor(uv * u_resolution / crushGrid) * crushGrid / u_resolution;
    uv = clamp(uv, 0.0, 1.0);
  }

  vec2 px = 1.0 / u_resolution;
  vec4 col = texture(u_src, uv);

  // Channel Permutation, Chromatic Separation & Solarization
  if (u_colorCorrupt > 0.0 && isCorrupt) {
    float colorProb = hash11(blockHash * 83.1);
    if (colorProb < u_colorCorrupt) {
      vec3 targetCol = col.rgb;
      float corruptMode = hash11(blockHash * 59.3);
      if (corruptMode < 0.35) {
        // Channel swap (BRG)
        targetCol = col.brg;
      } else if (corruptMode < 0.70) {
        // Channel swap (GBR)
        targetCol = col.gbr;
      } else {
        // Solarized invert
        targetCol = abs(vec3(1.0) - col.rgb * 1.6);
      }

      // Chromatic channel separation scaled by corruption amount
      vec2 chromaOffset = vec2((hash11(blockHash * 23.7) - 0.5) * px.x * 24.0 * u_pixel_scale * u_colorCorrupt, 0.0);
      targetCol.r = texture(u_src, clamp(uv + chromaOffset, 0.0, 1.0)).r;
      targetCol.b = texture(u_src, clamp(uv - chromaOffset, 0.0, 1.0)).b;

      // Continuous blend proportional to u_colorCorrupt
      col.rgb = mix(col.rgb, targetCol, sat(u_colorCorrupt * 1.2));
    }
  }

  // Color Bitcrush (depth reduction)
  if (u_bitcrush > 0.0) {
    float depthFactor = isCorrupt ? 1.0 : (u_intensity * burstEnv * 0.4);
    float bitSteps = mix(256.0, 4.0, u_bitcrush * depthFactor);
    col.rgb = floor(col.rgb * bitSteps) / bitSteps;
  }

  fragColor = vec4(clamp(col.rgb, 0.0, 1.0), col.a);
  `,
};
