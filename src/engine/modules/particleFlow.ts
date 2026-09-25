import type { EffectDef } from '../effects';

/**
 * Particle Flow (Strict Particle System / Luminance Velocity Modulation).
 *
 * Strict particle system snapped directly to display pixels:
 * - Particles are rendered exclusively on whole integer pixels, never in between.
 * - Zero fractional anti-aliasing or sub-pixel smudging.
 * - Particles travel in straight lines from the emitter.
 * - Speed is modulated by the driver: high luminance physically decelerates particles.
 * - By slowing down, particles cluster tightly to form the image directly by themselves.
 * - Full phosphor brightness across black areas.
 */
export const particleFlow: EffectDef = {
  id: 'particleFlow',
  label: 'Particle Flow',
  category: 'crt',
  animated: (params) => params.speed !== 0,
  mixable: true,
  params: [
    {
      kind: 'enum',
      key: 'emitter',
      label: 'Emitter Shape',
      options: ['Edge (Directional)', 'Point (Radial)', 'Cone Burst'],
      default: 0,
    },
    { kind: 'float', key: 'angle', label: 'Direction Angle', min: 0, max: 360, step: 1, default: 270 },
    { kind: 'vec2', key: 'origin', label: 'Emitter Origin', min: 0, max: 1, step: 0.01, default: [0.5, 0.5] },
    { kind: 'float', key: 'spread', label: 'Cone Spread', min: 10, max: 360, step: 2, default: 120 },
    {
      kind: 'enum',
      key: 'driver',
      label: 'Speed Driver',
      options: ['Luminance', 'Inverted Luma', 'Saturation', 'Edges', 'Red', 'Green', 'Blue', 'Hue'],
      default: 0,
    },
    { kind: 'float', key: 'speed', label: 'Travel Speed', min: -4, max: 4, step: 0.05, default: 1.0 },
    { kind: 'float', key: 'slowdown', label: 'Driver Slowdown', min: 0.0, max: 2.5, step: 0.02, default: 1.0 },
    { kind: 'float', key: 'density', label: 'Particle Quantity', min: 5, max: 150, step: 1, default: 35 },
    { kind: 'float', key: 'tracks', label: 'Streamlines', min: 5, max: 250, step: 1, default: 60 },
    { kind: 'float', key: 'stagger', label: 'Track Stagger', min: 0, max: 1.0, step: 0.02, default: 1.0 },
    { kind: 'float', key: 'size', label: 'Particle Size (px)', min: 0.5, max: 10.0, step: 0.1, default: 1.0 },
    {
      kind: 'enum',
      key: 'shape',
      label: 'Particle Shape',
      options: ['1-Pixel Phosphor (Strict Pixel Snap)', 'Pixel Square', 'CRT Persistence Trail'],
      default: 0,
    },
    { kind: 'float', key: 'trail', label: 'Trail Length', min: 0, max: 1.0, step: 0.02, default: 0.3 },
    { kind: 'float', key: 'glow', label: 'Phosphor Halo / Glow', min: 0, max: 1.0, step: 0.02, default: 0.0 },
    { kind: 'float', key: 'brightness', label: 'Brightness', min: 0.5, max: 4.0, step: 0.05, default: 1.5 },
    {
      kind: 'enum',
      key: 'mode',
      label: 'Output Mode',
      options: ['CRT Phosphor (Black BG)', 'Source Tinted (Black BG)', 'Inverted Ink (White BG)', 'Overlay on Source'],
      default: 0,
    },
    { kind: 'color', key: 'color', label: 'Phosphor Color', default: [1, 1, 1] },
  ],
  fragment: `  // Integer screen pixel coordinates (exact display pixel grid)
  vec2 pPx = floor(v_uv * u_resolution);
  float s_entry = 0.0;
  vec2 dir = vec2(0.0, -1.0);
  float trackDistPx = 0.0;
  float trackIdx = 0.0;
  float emitterMask = 1.0;

  if (u_emitter == 0) {
    // Edge (Directional Sweep)
    float rad = radians(u_angle);
    dir = vec2(cos(rad), sin(rad));
    if (length(dir) < 0.001) dir = vec2(0.0, -1.0);
    vec2 dirPerp = vec2(-dir.y, dir.x);

    // Distance back to screen entry boundary in integer pixels
    float tx = (dir.x > 0.0001) ? pPx.x / dir.x : ((dir.x < -0.0001) ? (pPx.x - u_resolution.x) / dir.x : 1e6);
    float ty = (dir.y > 0.0001) ? pPx.y / dir.y : ((dir.y < -0.0001) ? (pPx.y - u_resolution.y) / dir.y : 1e6);
    s_entry = max(min(tx, ty), 0.0);

    // Track transverse coordinate snapped to integer grid
    vec2 cPx = floor(0.5 * u_resolution);
    float wPx = dot(pPx - cPx, dirPerp);
    float trackSpacingPx = max(round(u_resolution.y / max(u_tracks, 1.0)), 1.0);
    float trackCoord = wPx / trackSpacingPx;
    trackIdx = floor(trackCoord + 0.5);
    trackDistPx = abs(wPx - trackIdx * trackSpacingPx);
  } else {
    // Point (Radial Rays) or Cone Burst
    vec2 ePx = floor(u_origin * u_resolution);
    vec2 deltaPx = pPx - ePx;
    s_entry = length(deltaPx);
    dir = (s_entry > 0.001) ? deltaPx / s_entry : vec2(0.0, 1.0);

    float theta = atan(deltaPx.y, deltaPx.x);
    float thetaNorm = mod(theta, TAU);
    float numTracks = max(round(u_tracks), 4.0);
    float trackCoord = (thetaNorm / TAU) * numTracks;
    trackIdx = floor(trackCoord + 0.5);
    float deltaAngle = abs(trackCoord - trackIdx) * (TAU / numTracks);
    trackDistPx = s_entry * sin(deltaAngle);

    if (u_emitter == 2) {
      // Cone Burst
      float centerRad = radians(u_angle);
      float diffAngle = mod(theta - centerRad + 3.14159265, TAU) - 3.14159265;
      float maxSpread = radians(max(u_spread, 5.0)) * 0.5;
      emitterMask = (abs(diffAngle) <= maxSpread) ? 1.0 : 0.0;
    }
    if (s_entry <= 4.0) emitterMask = 0.0;
  }

  // Local driver signal at current pixel
  vec4 srcCol = sampleEdge(u_src, v_uv, 0);
  float b = 0.0;
  if (u_driver == 0) {
    b = luma(srcCol.rgb);
  } else if (u_driver == 1) {
    b = 1.0 - luma(srcCol.rgb);
  } else if (u_driver == 2) {
    float mx = max(srcCol.r, max(srcCol.g, srcCol.b));
    float mn = min(srcCol.r, min(srcCol.g, srcCol.b));
    b = (mx > 0.001) ? (mx - mn) / mx : 0.0;
  } else if (u_driver == 3) {
    vec2 px = 1.5 / u_resolution;
    float lx = luma(sampleEdge(u_src, v_uv + vec2(px.x, 0.0), 0).rgb) - luma(sampleEdge(u_src, v_uv - vec2(px.x, 0.0), 0).rgb);
    float ly = luma(sampleEdge(u_src, v_uv + vec2(0.0, px.y), 0).rgb) - luma(sampleEdge(u_src, v_uv - vec2(0.0, px.y), 0).rgb);
    b = clamp(length(vec2(lx, ly)) * 6.0, 0.0, 1.0);
  } else if (u_driver == 4) {
    b = srcCol.r;
  } else if (u_driver == 5) {
    b = srcCol.g;
  } else if (u_driver == 6) {
    b = srcCol.b;
  } else if (u_driver == 7) {
    float mx = max(srcCol.r, max(srcCol.g, srcCol.b));
    float mn = min(srcCol.r, min(srcCol.g, srcCol.b));
    float d = mx - mn;
    b = (d > 0.001) ? fract(((mx == srcCol.r) ? (srcCol.g - srcCol.b) / d : (mx == srcCol.g) ? (srcCol.b - srcCol.r) / d + 2.0 : (srcCol.r - srcCol.g) / d + 4.0) / 6.0) : 0.0;
  }

  // Base spatial metrics
  float baseSpacingPx = max(round(u_resolution.y / max(u_density, 1.0)), 3.0);
  float trackSeed = hash11(trackIdx * 127.1 + 311.7);
  float trackOffset = trackSeed * baseSpacingPx * u_stagger;

  // Discrete integer pixel boundaries
  int maxAcrossPx = int(floor(max(u_size - 0.5, 0.0)));
  int intAcrossPx = int(round(trackDistPx));

  // Early-out if pixel is strictly between tracks
  if (intAcrossPx > maxAcrossPx) {
    fragColor = vec4(0.0);
    return;
  }

  // Pure line integral along trajectory
  const int NUM_STEPS = 32;
  float stepPx = s_entry / float(NUM_STEPS);
  vec2 stepUv = (dir * stepPx) / u_resolution;
  vec2 startUv = (pPx - s_entry * dir) / u_resolution;
  vec2 sampleUv = startUv + stepUv * 0.5;
  float accumB = 0.0;

  for (int i = 0; i < NUM_STEPS; i++) {
    vec4 tapCol = sampleEdge(u_src, sampleUv, 0);
    float sig = 0.0;
    if (u_driver == 0) {
      sig = luma(tapCol.rgb);
    } else if (u_driver == 1) {
      sig = 1.0 - luma(tapCol.rgb);
    } else if (u_driver == 2) {
      float mx = max(tapCol.r, max(tapCol.g, tapCol.b));
      float mn = min(tapCol.r, min(tapCol.g, tapCol.b));
      sig = (mx > 0.001) ? (mx - mn) / mx : 0.0;
    } else if (u_driver == 3) {
      vec2 px = 1.5 / u_resolution;
      float lx = luma(sampleEdge(u_src, sampleUv + vec2(px.x, 0.0), 0).rgb) - luma(sampleEdge(u_src, sampleUv - vec2(px.x, 0.0), 0).rgb);
      float ly = luma(sampleEdge(u_src, sampleUv + vec2(0.0, px.y), 0).rgb) - luma(sampleEdge(u_src, sampleUv - vec2(0.0, px.y), 0).rgb);
      sig = clamp(length(vec2(lx, ly)) * 6.0, 0.0, 1.0);
    } else if (u_driver == 4) {
      sig = tapCol.r;
    } else if (u_driver == 5) {
      sig = tapCol.g;
    } else if (u_driver == 6) {
      sig = tapCol.b;
    } else if (u_driver == 7) {
      float mx = max(tapCol.r, max(tapCol.g, tapCol.b));
      float mn = min(tapCol.r, min(tapCol.g, tapCol.b));
      float d = mx - mn;
      sig = (d > 0.001) ? fract(((mx == tapCol.r) ? (tapCol.g - tapCol.b) / d : (mx == tapCol.g) ? (tapCol.b - tapCol.r) / d + 2.0 : (tapCol.r - tapCol.g) / d + 4.0) / 6.0) : 0.0;
    }
    accumB += sig * stepPx;
    sampleUv += stepUv;
  }

  // Physical particle propagation
  float pathLen = s_entry + u_slowdown * 4.0 * accumB;
  float travelDist = u_phase_speed * 140.0 + trackOffset;
  float P = (travelDist - pathLen) / baseSpacingPx;

  float particle = 0.0;
  if (P >= -0.5) {
    float fracPhase = fract(P + 0.5) - 0.5;
    float localSpacing = baseSpacingPx / max(1.0 + u_slowdown * 4.0 * b, 0.1);
    float distAlongPx = abs(fracPhase) * localSpacing;
    int intAlongPx = int(round(distAlongPx));
    int maxAlongPx = int(floor(max(u_size - 0.5, 0.0)));

    if (u_shape == 2) {
      // CRT Persistence Trail snapped to integer pixels
      if (fracPhase >= 0.0) {
        particle = (intAlongPx <= maxAlongPx) ? 1.0 : 0.0;
      } else {
        float trailDist = -fracPhase * localSpacing;
        float trailLen = max(u_trail * 40.0, 1.0);
        float tVal = exp(-trailDist / trailLen);
        particle = (tVal > 0.08) ? tVal : 0.0;
      }
    } else {
      // Strict pixel snap: exactly 1 pixel (or integer pixel radius), never in between
      if (intAlongPx <= maxAlongPx && intAcrossPx <= maxAcrossPx) {
        particle = 1.0;
      }
      if (u_glow > 0.0 && particle > 0.0) {
        // Optional subtle phosphor bloom
        particle = mix(1.0, 1.0 + u_glow * 0.5, u_glow);
      }
    }
  }

  float hit = particle * u_brightness * emitterMask;

  vec4 finalCol;
  if (u_mode == 0) {
    // CRT Phosphor (Black BG)
    vec3 phosphor = hit * u_color;
    finalCol = vec4(phosphor, 1.0);
  } else if (u_mode == 1) {
    // Source Tinted (Black BG)
    vec3 phosphor = hit * mix(u_color, srcCol.rgb, 0.9);
    finalCol = vec4(phosphor, 1.0);
  } else if (u_mode == 2) {
    // Inverted Ink (White BG)
    float ink = sat(hit);
    vec3 paper = vec3(0.96, 0.95, 0.93);
    finalCol = vec4(mix(paper, vec3(0.04), ink), 1.0);
  } else {
    // Overlay on Source
    vec4 base = texture(u_src, v_uv);
    finalCol = vec4(base.rgb + hit * u_color, base.a);
  }

  fragColor = finalCol;`,
};
