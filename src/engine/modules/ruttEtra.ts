import type { EffectDef } from '../effects';

/**
 * Rutt-Etra / raster deflection video synthesizer effect.
 *
 * Emulates the iconic 1970s analog scan-processor (Steve Rutt & Bill Etra),
 * converting video into horizontal electron-beam scanlines deflected vertically
 * by luminance and modulated by a high-frequency carrier wave ripple.
 */
export const ruttEtra: EffectDef = {
  id: 'ruttEtra',
  label: 'Rutt-Etra',
  category: 'crt',
  animated: (params) => params.speed !== 0,
  mixable: true,
  params: [
    { kind: 'float', key: 'lines', label: 'Lines', min: 20, max: 350, step: 2, default: 120 },
    { kind: 'float', key: 'lineWidth', label: 'Line Width', min: 0.5, max: 4.0, step: 0.1, default: 1.2 },
    { kind: 'float', key: 'deflection', label: 'Deflection', min: -0.3, max: 0.3, step: 0.005, default: 0.09 },
    { kind: 'float', key: 'ripple', label: 'Ripple', min: 0, max: 0.05, step: 0.001, default: 0.015 },
    { kind: 'float', key: 'frequency', label: 'Frequency', min: 5, max: 150, step: 1, default: 45 },
    { kind: 'float', key: 'speed', label: 'Speed', min: -4, max: 4, step: 0.05, default: 1.0 },
    { kind: 'float', key: 'spread', label: 'Spread', min: 0, max: 1, step: 0.01, default: 0.25 },
    { kind: 'float', key: 'brightness', label: 'Brightness', min: 0.5, max: 3.0, step: 0.05, default: 1.4 },
    { kind: 'float', key: 'baseBrightness', label: 'Shadow Lines', min: 0, max: 0.4, step: 0.01, default: 0.06 },
    {
      kind: 'enum',
      key: 'mode',
      label: 'Mode',
      options: ['Additive Glow', 'Source Shaded', 'Inverted Ink', 'Overlay'],
      default: 0,
    },
    { kind: 'color', key: 'color', label: 'Color', default: [1, 1, 1] },
  ],
  fragment: `  float numLines = max(u_lines, 10.0);
  float hw = max(u_lineWidth * 0.5 * u_pixel_scale, 0.4);
  float invHwSq = -0.5 / (hw * hw);

  // Only the lines whose beam can land on this pixel are visited. A beam
  // leaves line k at (k + 0.5) and moves by luma * deflection (luma 0..1)
  // plus up to +-ripple, and is visible hw * 3.5 pixels either side, so
  // the window is exactly that span -- in line units -- and grows with the
  // deflection instead of losing beams past a fixed search radius.
  float yLines = v_uv.y * numLines;
  float deflLines = u_deflection * numLines;
  float reach = abs(u_ripple) * numLines + hw * 3.5 * numLines / max(u_resolution.y, 1.0) + 1.0;
  int kStart = int(floor(yLines - max(deflLines, 0.0) - reach - 0.5));
  int kEnd = int(ceil(yLines - min(deflLines, 0.0) + reach - 0.5));
  kStart = max(kStart, 0);
  kEnd = min(kEnd, int(numLines) - 1);

  vec3 accumGlow = vec3(0.0);
  float accumDark = 0.0;

  // The constant bound is a safety net only: full deflection at the most
  // lines spans ~105 lines plus ripple and beam width.
  const int MAX_TAPS = 192;
  for (int i = 0; i < MAX_TAPS; i++) {
    int k = kStart + i;
    if (k > kEnd) break;

    float yk = (float(k) + 0.5) / numLines;
    vec4 srcSample = sampleEdge(u_src, vec2(v_uv.x, yk), 0);
    float lumaVal = luma(srcSample.rgb);

    // Carrier wave ripple modulated by local signal
    float signal = lumaVal;
    // 159 whole cycles per 1000 phase units (~1 rad each): seamless when the
    // phase wraps at 1000.
    float carrierPhase = v_uv.x * u_frequency + u_phase_speed * (159.0 * TAU / 1000.0) + float(k) * (u_spread * TAU);
    float ripple = sin(carrierPhase) * u_ripple * signal;

    // Total vertical deflection
    float totalDeflect = lumaVal * u_deflection + ripple;
    float Yk = yk + totalDeflect;

    // Distance to deflected beam
    float distPx = abs(v_uv.y - Yk) * u_resolution.y;
    if (distPx > hw * 3.5) continue;

    float beam = exp(distPx * distPx * invHwSq);
    float lineLum = mix(u_baseBrightness, 1.0, clamp(signal, 0.0, 1.0));
    float hit = beam * lineLum * u_brightness;

    accumGlow += hit * ((u_mode == 1) ? mix(u_color, srcSample.rgb, 0.85) : u_color);
    accumDark = max(accumDark, hit);
  }

  vec4 finalCol;
  if (u_mode == 0 || u_mode == 1) {
    vec3 glow = vec3(1.0) - exp(-accumGlow * 1.2);
    finalCol = vec4(glow, 1.0);
  } else if (u_mode == 2) {
    float inkDensity = 1.0 - exp(-accumDark * 1.5);
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
