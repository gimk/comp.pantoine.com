import type { EffectDef } from '../effects';

/**
 * Analog RF signal rot and multi-generation composite tape decay.
 *
 * Models RF multipath ghosting reflections, high-frequency smear & overshoot ringing,
 * NTSC subcarrier hue drift, horizontal scanline sync slippage, and carrier noise.
 */
export const signalRot: EffectDef = {
  id: 'signalRot',
  label: 'Signal Rot',
  category: 'tape',
  animated: (params) => params.decay !== 0 && (params.noise !== 0 || params.syncLoss !== 0 || params.rate !== 0),
  mixable: true,
  params: [
    { kind: 'float', key: 'decay', label: 'Decay', min: 0, max: 1, step: 0.01, default: 0.4 },
    { kind: 'float', key: 'ghosting', label: 'Ghosting', min: 0, max: 1, step: 0.01, default: 0.3 },
    { kind: 'float', key: 'smear', label: 'HF Smear', min: 0, max: 1, step: 0.01, default: 0.35 },
    { kind: 'float', key: 'colorDrift', label: 'Hue Drift', min: -1, max: 1, step: 0.02, default: 0.2 },
    { kind: 'float', key: 'syncLoss', label: 'Sync Loss', min: 0, max: 1, step: 0.01, default: 0.25 },
    { kind: 'float', key: 'noise', label: 'Carrier Noise', min: 0, max: 1, step: 0.01, default: 0.2 },
    { kind: 'float', key: 'rate', label: 'Rate', min: 0, max: 3, step: 0.05, default: 1.0 },
  ],
  fragment: `
  // Scanline sync slippage & tear
  // Scanlines and snow are counted in source pixels, so a reduced preview
  // tears the same rows as the full-size export.
  float pxScale = max(u_pixel_scale, 0.001);
  float scanline = floor(v_uv.y * u_resolution.y / pxScale);
  float lineStep = floor(u_phase_rate * 9.0);
  float lineSeed = hash12(vec2(scanline * 0.13, lineStep * 1.71 + u_seed * 23.4));

  float tear = 0.0;
  if (lineSeed < u_syncLoss * 0.25) {
    tear = (hash11(lineSeed * 41.7) - 0.5) * (u_syncLoss * 0.12 * u_decay);
  }
  // Micro-sync jitter
  tear += (hash11(scanline + u_phase_rate * 32.0) - 0.5) * (u_syncLoss * 0.005 * u_decay);

  vec2 uv = clamp(v_uv + vec2(tear, 0.0), 0.0, 1.0);
  vec4 baseCol = texture(u_src, uv);

  // High-frequency smear & overshoot ringing
  float px = 1.0 / u_resolution.x;
  float smearDist = u_smear * u_decay * 20.0 * u_pixel_scale;

  vec4 smeared = baseCol * 0.35;
  smeared += texture(u_src, clamp(uv - vec2(px * smearDist * 0.3, 0.0), 0.0, 1.0)) * 0.25;
  smeared += texture(u_src, clamp(uv - vec2(px * smearDist * 0.7, 0.0), 0.0, 1.0)) * 0.20;
  smeared += texture(u_src, clamp(uv - vec2(px * smearDist * 1.2, 0.0), 0.0, 1.0)) * 0.15;
  smeared += texture(u_src, clamp(uv - vec2(px * smearDist * 1.8, 0.0), 0.0, 1.0)) * 0.05;

  // Edge ringing overshoot
  vec4 ringSample = texture(u_src, clamp(uv - vec2(px * smearDist * 2.2, 0.0), 0.0, 1.0));
  vec4 ring = (ringSample - baseCol) * (u_smear * 0.35 * u_decay);

  vec4 col = mix(baseCol, smeared + ring, sat(u_decay * 1.4));

  // Multipath RF ghosting echoes
  if (u_ghosting > 0.0) {
    vec2 ghostUv1 = clamp(uv + vec2(px * 16.0 * u_pixel_scale * u_ghosting, 0.0), 0.0, 1.0);
    vec2 ghostUv2 = clamp(uv + vec2(px * 36.0 * u_pixel_scale * u_ghosting, 0.0), 0.0, 1.0);
    vec4 g1 = texture(u_src, ghostUv1);
    vec4 g2 = texture(u_src, ghostUv2);
    col = col + (g1 * 0.35 - g2 * 0.15) * (u_ghosting * u_decay);
  }

  // NTSC Subcarrier Hue Drift
  if (abs(u_colorDrift) > 0.0) {
    float driftAngle = u_colorDrift * 3.14159 * 0.4 * u_decay;
    // 398 whole cycles per 1000 phase units (~2.5 rad each): the phase
    // wraps at 1000, and this keeps the wobble seamless across the wrap.
    driftAngle += sin(v_uv.y * 24.0 + u_phase_rate * (398.0 * TAU / 1000.0)) * (u_decay * 0.15);
    col.rgb = hueRotate(col.rgb, driftAngle);
  }

  // RF Carrier Noise / Snow
  if (u_noise > 0.0) {
    float rfNoise = hash22(v_uv * u_resolution / pxScale + vec2(u_phase_rate * 149.3, u_seed * 51.7)).x;
    float noiseWeight = u_noise * u_decay * 0.35;
    if (lineSeed < u_syncLoss * 0.25) {
      noiseWeight += u_syncLoss * 0.35;
    }
    col.rgb = mix(col.rgb, vec3(rfNoise), sat(noiseWeight));
  }

  fragColor = vec4(clamp(col.rgb, 0.0, 1.0), baseCol.a);
  `,
};
