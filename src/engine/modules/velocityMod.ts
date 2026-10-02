import type { EffectDef } from '../effects';

/**
 * Phase Modulation: rolling raster lines whose phase is offset by the
 * picture, pixel by pixel.
 *
 *   phase = Lines * y - Depth * driver - ripple
 *
 * with y across the lines -- down the frame for horizontal lines, along
 * it for vertical ones.
 *
 * The offset depends on the driver at this pixel and nothing else, which
 * is what makes it PM rather than FM: lines bend where the picture is
 * bright and are back on the carrier's grid wherever it is dark again.
 * Depth is in cycles -- 1 moves a line onto the next one's place -- so it
 * means the same at any line count. Frequency Modulation is the
 * integrating counterpart, where a bright patch shifts everything after it.
 *
 * Kept as id `velocityMod` so saved documents still find it. It used to
 * have a Slowdown that multiplied the line density by the driver; density
 * times position is neither PM nor FM -- its effect grew towards the
 * bottom of the frame and tore lines at every edge -- so it is gone, and
 * Deflection became Depth.
 */
export const velocityMod: EffectDef = {
  id: 'velocityMod',
  label: 'Phase Modulation',
  category: 'crt',
  animated: (params) => params.speed !== 0,
  mixable: true,
  params: [
    {
      kind: 'enum',
      key: 'driver',
      label: 'Driver',
      options: ['Luminance', 'Inverted Luma', 'Saturation', 'Edges', 'Red', 'Green', 'Blue', 'Hue'],
      default: 0,
    },
    { kind: 'enum', key: 'axis', label: 'Axis', options: ['Horizontal Lines', 'Vertical Lines'], default: 0 },
    { kind: 'float', key: 'lines', label: 'Lines', min: 20, max: 250, step: 2, default: 100 },
    { kind: 'float', key: 'lineWidth', label: 'Line Width', min: 0.5, max: 3.5, step: 0.1, default: 1.2 },
    { kind: 'float', key: 'speed', label: 'Roll Speed', min: -3, max: 3, step: 0.05, default: 1.0 },
    /** Phase offset at a driver of 1, in cycles. */
    { kind: 'float', key: 'depth', label: 'Depth', min: -8, max: 8, step: 0.05, default: 2 },
    /** A sine along each line, its amplitude set by the driver: cycles at a driver of 1. */
    { kind: 'float', key: 'ripple', label: 'Ripple', min: 0, max: 2, step: 0.01, default: 0.6 },
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
    vec2 px = 1.5 * u_pixel_scale / u_resolution;
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

  // The phase, in cycles: the carrier's, offset by the driver here. The
  // ripple is a sine along the lines, its amplitude also set by the driver.
  // 127 whole cycles per 1000 phase units (~0.8 rad each), so it stays
  // continuous when the phase wraps at 1000.
  //
  // Worked in line space: across runs across the lines, the way the
  // phase advances, along runs along them. Vertical lines are the same
  // picture with the two swapped.
  vec2 lineUv = u_axis == 0 ? v_uv : v_uv.yx;
  vec2 lineRes = u_axis == 0 ? u_resolution : u_resolution.yx;
  float along = lineUv.x;
  float across = lineUv.y;
  float numLines = max(u_lines, 1.0);
  float ripple = sin(along * u_frequency + u_phase_speed * (127.0 * TAU / 1000.0)) * u_ripple * b;
  float linePhase = across * numLines - u_depth * b - ripple - u_phase_speed;

  // Distance to the nearest line in screen pixels.
  //
  // The phase-per-pixel is the carrier's slope alone. fwidth(linePhase)
  // would also pick up the driver's offset, which jumps at every hard edge
  // in the picture -- the width then balloons there and draws a bright
  // outline around everything.
  float dPhase = abs(fract(linePhase + 0.5) - 0.5);
  float fw = max(numLines / max(lineRes.y, 1.0), 0.0001);
  float distPx = dPhase / fw;

  float hw = max(u_lineWidth * 0.5 * u_pixel_scale, 0.4);
  float lineBeam = exp(-0.5 * (distPx * distPx) / (hw * hw));

  // Dot modulation along the line (staggered on alternating lines to avoid vertical banding)
  float beam = lineBeam;
  if (u_dotDensity > 0.5) {
    float lineIndex = floor(linePhase + 0.5);
    float dotPhase = along * u_dotDensity + lineIndex * 0.5 - u_phase_speed * 1.2;
    float dotP = abs(fract(dotPhase + 0.5) - 0.5);
    // Analytic as above: fwidth would spike at the lineIndex step and at edges.
    float dotFw = max(u_dotDensity / max(lineRes.x, 1.0), 0.0001);
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
