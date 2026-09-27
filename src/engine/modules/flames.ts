import type { EffectDef } from '../effects';

/**
 * Rising thermal feedback: the frame before this one buoyed upward by heat,
 * whipped into licking tongues by convective turbulence, and cooled through
 * a blackbody thermal gradient.
 *
 * Like Echo, it reads its own previous flame field (not the composite) to
 * build a receding stack of ghost frames. Frame Step sets the pixel spacing between successive flame
 * frames: a small step stacks frames densely into a continuous fluid plume,
 * while a large step separates them into distinct, stepped flame echoes.
 * The step is measured per 1/60 s rather than per frame, so the rise speed
 * does not depend on the frame rate, and a paused redraw does not move it.
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
  // Pass 0 is the flame field alone, and it is what is kept as history, so
  // the fire feeds on its own heat only. Compositing in a later pass keeps
  // the live picture out of the loop: with it fed back, Add re-added the
  // source every frame until the frame blew out to white, and Max sent the
  // picture itself rising up the frame as if it were fire.
  feedbackPass: 0,
  fragment: [
    `  // Seconds this frame, 0 on a paused redraw. Everything that advances the
  // plume -- rise, turbulence, diffusion, cooling -- is scaled by it, so the
  // fire holds still while paused and moves at the same speed at any frame
  // rate. The per-step knobs were tuned at 60 fps, hence the 60.
  float dt = clamp(u_delta, 0.0, 0.05);
  float frames = dt * 60.0;

  // Upward frame step and wind drift in source pixels, scaled to UV
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  vec2 stepPx = vec2(u_wind * u_step, u_step) * u_pixel_scale * frames;
  vec2 shift = stepPx * px;

  // Convective noise field (animated by phase)
  vec2 turbCoord = aspectUv(v_uv, u_resolution) * 4.0;
  float phase = u_phase_speed;
  vec2 noiseP = turbCoord + vec2(-u_wind * phase * 0.5, -phase * 2.0) + u_seed * 23.1;

  // Periodic in y by exactly what the phase moves the field in one wrap
  // (2 and 4.9 lattice units per phase unit), so the turbulence carries on
  // seamlessly when the phase goes from 1000 back to 0.
  vec2 wrap1 = vec2(0.0, PHASE_WRAP * 2.0);
  vec2 wrap2 = vec2(0.0, PHASE_WRAP * 4.9);
  float n1 = valueNoisePeriodic(noiseP, wrap1);
  float n2 = valueNoisePeriodic(noiseP * 2.1 + vec2(17.3, -phase * 0.7), wrap2);
  float turbX = (n1 * 0.65 + n2 * 0.35) - 0.5;

  float n3 = valueNoisePeriodic(noiseP + vec2(43.7, 19.1), wrap1);
  float turbY = n3 - 0.5;

  // Licking flame displacement in pixel units (scaled to UV)
  vec2 turbPx = vec2(turbX * 1.5, turbY * 0.5) * (u_turbulence * 12.0) * u_pixel_scale * frames;
  vec2 sampleUv = v_uv - (shift + turbPx * px);

  // Heat diffusion: at smoothness 0, sample only center tap (sharp discrete echo frames);
  // at higher smoothness, blur with neighbors to melt into continuous fluid fire.
  float spreadPx = u_smoothness * 3.5 * u_pixel_scale;
  vec2 spread = px * spreadPx;

  vec2 uvL = sampleUv - vec2(spread.x, 0.0);
  vec2 uvR = sampleUv + vec2(spread.x, 0.0);
  vec2 uvD = sampleUv - vec2(0.0, spread.y);
  vec4 prevC = sampleEdge(u_prev, sampleUv, 2);
  vec4 prevL = sampleEdge(u_prev, uvL, 2);
  vec4 prevR = sampleEdge(u_prev, uvR, 2);
  vec4 prevD = sampleEdge(u_prev, uvD, 2);

  // The share kept at the centre compounds per 60 fps step, so a paused
  // frame (0 steps) does not diffuse at all.
  float centerW = pow(mix(1.0, 0.35, u_smoothness), frames);
  float neighborW = (1.0 - centerW) / 3.0;
  vec4 prev = prevC * centerW + (prevL + prevR + prevD) * neighborW;

  // Differential cooling per channel
  float k = pow(0.1, dt / max(u_persistence, 0.001));
  float cool = pow(sat(1.0 - u_turbulence * 0.15 * abs(turbX)), frames);
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
  fragColor = vec4(flame, 1.0);`,

    // Composite the flame field (u_src here) over the live picture.
    `  vec4 src = texture(u_orig, v_uv);
  vec3 flame = texture(u_src, v_uv).rgb;

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
  ],
};
