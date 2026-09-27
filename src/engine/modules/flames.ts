import type { EffectDef } from '../effects';

/**
 * Rising thermal feedback: the frame before this one buoyed upward by heat,
 * whipped into licking tongues by convective turbulence, and cooled through
 * a blackbody thermal gradient.
 *
 * Like Echo, it reads its own previous output to build a receding stack of
 * ghost frames. Frame Step sets the pixel spacing between successive flame
 * frames: a small step stacks frames densely into a continuous fluid plume,
 * while a large step separates them into distinct, stepped flame echoes.
 *
 * Smoothness controls the neighborhood heat diffusion: dialed down to 0, each
 * flame ghost retains crisp contours; dialed up, heat diffuses across
 * neighbors into soft, billowing fire plumes.
 *
 * Cooling is differential across channels rather than a flat dimming: as
 * heat radiates away, blue drops first (white-hot core to golden yellow),
 * green drops next (yellow to burning orange, then crimson), and red lingers
 * longest as dark smoky embers before extinguishing.
 */
export const flames: EffectDef = {
  id: 'flames',
  label: 'Flames',
  category: 'temporal',
  animated: true,
  feedback: true,
  params: [
    { kind: 'float', key: 'speed', label: 'Speed', min: 0.05, max: 2, step: 0.01, default: 0.4 },
    { kind: 'float', key: 'step', label: 'Frame Step', min: 1, max: 64, step: 0.5, default: 4 },
    { kind: 'float', key: 'smoothness', label: 'Smoothness', min: 0, max: 1, step: 0.02, default: 0.5 },
    { kind: 'float', key: 'persistence', label: 'Persistence (s)', min: 0.05, max: 4, step: 0.05, default: 0.8 },
    { kind: 'float', key: 'turbulence', label: 'Turbulence', min: 0, max: 2, step: 0.02, default: 0.5 },
    { kind: 'float', key: 'wind', label: 'Wind', min: -1, max: 1, step: 0.02, default: 0 },
    { kind: 'float', key: 'intensity', label: 'Intensity', min: 0.2, max: 3, step: 0.05, default: 1 },
    { kind: 'enum', key: 'palette', label: 'Palette', options: ['Inferno', 'Blue', 'Acid', 'Ghost'], default: 0 },
    { kind: 'enum', key: 'blend', label: 'Blend', options: ['Max', 'Add', 'Flame Only'], default: 0 },
  ],
  fragment: `  float dt = clamp(u_delta, 0.001, 0.05);

  // Upward frame step and wind drift in pixel units, scaled to UV
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  vec2 stepPx = vec2(u_wind * u_step, u_step);
  vec2 shift = stepPx * px;

  // Convective noise field (animated by phase)
  vec2 turbCoord = aspectUv(v_uv, u_resolution) * 4.0;
  float phase = u_phase_speed;
  vec2 noiseP = turbCoord + vec2(-u_wind * phase * 0.5, -phase * 2.0) + u_seed * 23.1;

  float n1 = valueNoise(noiseP);
  float n2 = valueNoise(noiseP * 2.1 + vec2(17.3, -phase * 0.7));
  float turbX = (n1 * 0.65 + n2 * 0.35) - 0.5;

  float n3 = valueNoise(noiseP + vec2(43.7, 19.1));
  float turbY = n3 - 0.5;

  // Licking flame displacement in pixel units (scaled to UV)
  vec2 turbPx = vec2(turbX * 1.5, turbY * 0.5) * (u_turbulence * 12.0);
  vec2 sampleUv = v_uv - (shift + turbPx * px);

  // Heat diffusion: at smoothness 0, sample only center tap (sharp discrete echo frames);
  // at higher smoothness, blur with neighbors to melt into continuous fluid fire.
  float spreadPx = u_smoothness * 3.5;
  vec2 spread = px * spreadPx;

  vec4 prevC = sampleEdge(u_prev, sampleUv, 2);
  vec4 prevL = sampleEdge(u_prev, sampleUv - vec2(spread.x, 0.0), 2);
  vec4 prevR = sampleEdge(u_prev, sampleUv + vec2(spread.x, 0.0), 2);
  vec4 prevD = sampleEdge(u_prev, sampleUv - vec2(0.0, spread.y), 2);

  float centerW = mix(1.0, 0.35, u_smoothness);
  float neighborW = (1.0 - centerW) / 3.0;
  vec4 prev = prevC * centerW + (prevL + prevR + prevD) * neighborW;

  // Differential cooling per channel
  float k = pow(0.1, dt / max(u_persistence, 0.001));
  float cool = sat(1.0 - u_turbulence * 0.15 * abs(turbX));
  float decay = k * cool;

  vec3 cooled;
  if (u_palette == 0) {
    // Inferno: Red cools slowest, Blue drops off immediately
    cooled = vec3(prev.r * pow(decay, 0.75), prev.g * pow(decay, 1.6), prev.b * pow(decay, 3.2));
  } else if (u_palette == 1) {
    // Blue flame: Blue cools slowest, Red drops off immediately
    cooled = vec3(prev.r * pow(decay, 3.2), prev.g * pow(decay, 1.6), prev.b * pow(decay, 0.75));
  } else if (u_palette == 2) {
    // Acid flame: Green cools slowest
    cooled = vec3(prev.r * pow(decay, 1.8), prev.g * pow(decay, 0.75), prev.b * pow(decay, 3.5));
  } else {
    // Ghost: Uniform decay preserving input color
    cooled = prev.rgb * decay;
  }

  // Ignition from live source
  vec4 src = texture(u_src, v_uv);
  float srcLuma = luma(src.rgb);
  float srcMax = max(src.r, max(src.g, src.b));
  float heat = max(srcLuma, srcMax * 0.7) * src.a;

  vec3 ignition;
  if (u_palette == 0) {
    ignition = vec3(heat * 1.2, pow(heat, 1.4) * 0.95, pow(heat, 2.5) * 0.8) * u_intensity;
  } else if (u_palette == 1) {
    ignition = vec3(pow(heat, 2.5) * 0.8, pow(heat, 1.4) * 0.95, heat * 1.2) * u_intensity;
  } else if (u_palette == 2) {
    ignition = vec3(pow(heat, 1.6) * 0.9, heat * 1.2, pow(heat, 2.8) * 0.7) * u_intensity;
  } else {
    ignition = src.rgb * u_intensity;
  }

  vec3 flame = max(ignition, cooled);

  // Composite with live picture
  vec3 outRgb;
  if (u_blend == 1) {
    outRgb = src.rgb + flame;
  } else if (u_blend == 2) {
    outRgb = flame;
  } else {
    outRgb = max(src.rgb, flame);
  }

  float flameAlpha = sat(luma(flame) * 1.5);
  float outAlpha = max(src.a, flameAlpha);

  fragColor = vec4(outRgb, outAlpha);`,
};
