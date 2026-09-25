import type { EffectDef } from '../effects';

/**
 * Velocity Modulation (Moving Scanlines / Velocity Slowdown / Beam Congestion).
 *
 * Emulates continuous rolling raster scanlines whose propagation velocity is
 * governed by an image parameter (Luminance, Inverted Luma, Saturation, Edges,
 * Red, Green, Blue, or Hue). Where the driver signal is high, lines decelerate
 * and bunch together into dense, glowing 3D relief contours.
 *
 * Designed with physical wave dispersion where slowdown scales the spatial
 * wavenumber, ensuring exact zero at 0.0 without runaway time-accumulation drift.
 */
export const velocityMod: EffectDef = {
  id: 'velocityMod',
  label: 'Velocity Modulation',
  category: 'crt',
  animated: (params) => params.speed !== 0,
  mixable: true,
  params: [
    {
      kind: 'enum',
      key: 'driver',
      label: 'Velocity Driver',
      options: ['Luminance', 'Inverted Luma', 'Saturation', 'Edges', 'Red', 'Green', 'Blue', 'Hue'],
      default: 0,
    },
    { kind: 'float', key: 'lines', label: 'Lines', min: 20, max: 250, step: 2, default: 100 },
    { kind: 'float', key: 'lineWidth', label: 'Line Width', min: 0.5, max: 3.5, step: 0.1, default: 1.2 },
    { kind: 'float', key: 'speed', label: 'Roll Speed', min: -3, max: 3, step: 0.05, default: 1.0 },
    { kind: 'float', key: 'slowdown', label: 'Slowdown', min: -0.2, max: 0.4, step: 0.005, default: 0.08 },
    { kind: 'float', key: 'deflection', label: 'Deflection', min: -0.15, max: 0.15, step: 0.002, default: 0.04 },
    { kind: 'float', key: 'ripple', label: 'Ripple', min: 0, max: 0.025, step: 0.001, default: 0.006 },
    { kind: 'float', key: 'frequency', label: 'Ripple Freq', min: 5, max: 100, step: 1, default: 35 },
    { kind: 'float', key: 'dotDensity', label: 'Dot Density', min: 0, max: 150, step: 1, default: 45 },
    { kind: 'float', key: 'brightness', label: 'Brightness', min: 0.5, max: 2.5, step: 0.05, default: 1.4 },
    { kind: 'float', key: 'shadowFade', label: 'Shadow Fade', min: 0, max: 1.0, step: 0.02, default: 0.2 },
    { kind: 'float', key: 'baseBrightness', label: 'Shadow Lines', min: 0, max: 0.3, step: 0.01, default: 0.05 },
    {
      kind: 'enum',
      key: 'mode',
      label: 'Mode',
      options: ['Additive Glow', 'Source Shaded', 'Inverted Ink', 'Overlay'],
      default: 0,
    },
    { kind: 'color', key: 'color', label: 'Color', default: [1, 1, 1] },
  ],
  fragment: `  vec4 srcCol = sampleEdge(u_src, v_uv, 0);

  // Extract driver signal at current pixel
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

  // Carrier wave ripple modulated by local driver signal
  float carrier = sin(v_uv.x * u_frequency + u_phase_speed * 0.8);
  float ripple = carrier * u_ripple * b;

  // 3D vertical deflection
  float totalDeflect = b * u_deflection + ripple;

  // Continuous horizontal scanline coordinate with physical wave slowdown
  // Wavenumber k = lines * (1 + slowdown * b) => velocity v = omega / k (slows down where bright)
  float yEff = v_uv.y - totalDeflect;
  float lineDensity = u_lines * max(1.0 + u_slowdown * 1.5 * b, 0.1);
  float linePhase = yEff * lineDensity - u_phase_speed;

  // Distance to rolling line in screen pixels (exact Euclidean distance)
  float dPhase = abs(fract(linePhase + 0.5) - 0.5);
  float fw = max(fwidth(linePhase), 0.001);
  float distPx = dPhase / fw;

  float hw = max(u_lineWidth * 0.5, 0.4);
  float lineBeam = exp(-0.5 * (distPx * distPx) / (hw * hw));

  // Dot modulation along the line (staggered on alternating lines to avoid vertical banding)
  float beam = lineBeam;
  if (u_dotDensity > 0.5) {
    float lineIndex = floor(linePhase + 0.5);
    float effDensity = u_dotDensity * max(1.0 + u_slowdown * b, 0.1);
    float dotPhase = v_uv.x * effDensity + lineIndex * 0.5 - u_phase_speed * 1.2;
    float dotP = abs(fract(dotPhase + 0.5) - 0.5);
    float dotFw = max(fwidth(dotPhase), 0.001);
    float dotDistPx = dotP / dotFw;
    float dotMask = exp(-0.5 * (dotDistPx * dotDistPx) / (hw * hw));

    // In driver peaks, dots merge into solid glowing contours
    beam = lineBeam * mix(dotMask, 1.0, clamp(b * 1.3, 0.0, 1.0));
  }

  // Driver visibility & modulation
  float vis = smoothstep(u_shadowFade * 0.5, u_shadowFade * 0.5 + 0.25, b);
  float lumIntensity = mix(u_baseBrightness, 1.0, vis);
  float hit = beam * lumIntensity * u_brightness;

  vec3 accumGlow = hit * ((u_mode == 1) ? mix(u_color, srcCol.rgb, 0.85) : u_color);

  vec4 finalCol;
  if (u_mode == 0 || u_mode == 1) {
    vec3 glow = vec3(1.0) - exp(-accumGlow * 1.2);
    finalCol = vec4(glow, 1.0);
  } else if (u_mode == 2) {
    float inkDensity = 1.0 - exp(-hit * 1.5);
    vec3 paper = vec3(0.96, 0.95, 0.93);
    vec3 ink = mix(paper, u_color * 0.05, inkDensity);
    finalCol = vec4(ink, 1.0);
  } else {
    vec4 base = texture(u_src, v_uv);
    vec3 glow = vec3(1.0) - exp(-accumGlow * 1.2);
    finalCol = vec4(base.rgb + glow * u_color, base.a);
  }

  fragColor = finalCol;`,
};
