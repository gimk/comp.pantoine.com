import type { EffectDef } from '../effects';

/**
 * True frequency modulation along each scanline.
 *
 * The picture sets how fast the lines come, not where they sit: brightness
 * is the instantaneous frequency, and the phase is its running integral
 * along the row. So a bright patch packs the lines tight *and* everything
 * after it on the row stays shifted, even once the row goes dark again --
 * the cascading look of the After Effects "Modulation" plugin and the
 * TouchDesigner FM patches. Velocity Modulation, by contrast, displaces
 * the phase locally (PM), and its lines snap back to the grid the moment
 * the driver lets go.
 *
 * The integral is a prefix sum, done on the GPU because the input is a
 * live picture (a video, an animated chain) rather than a still that could
 * be summed once on the CPU:
 *
 *   0. integrand -- the frequency at each pixel, in cycles per pixel:
 *      (carrier + depth * driver) / length of the row. Carrier and Depth
 *      are read here, at each pixel, so either can take a field and the
 *      sum is still the true integral of a varying frequency;
 *   1. local scan -- each pixel sums its own block of BLOCK pixels up to
 *      itself;
 *   2. block scan -- adds the totals of every earlier block, read off the
 *      last pixel of each, which gives the full running sum;
 *   3. render -- draws the wave at that phase.
 *
 * Only the fractional part of a phase is ever seen, so the scans keep
 * their sums modulo one. That keeps them small and exact in full float,
 * and still usable where the GPU only has half float to give.
 *
 * Normalising by the row length means Carrier is a count of lines across
 * the frame, like Scanlines' Lines, and a preview and a full-size export
 * draw the same picture.
 */

/** Pixels per block in the local scan; the block scan reads one per block. */
const BLOCK = 64;
/** Blocks the block scan will walk: rows up to 16384 pixels. */
const MAX_BLOCKS = 256;

/** The driver signal, 0..1, from the Modulator input or else the picture. */
const DRIVER = `  vec4 driverSrc = textureSize(u_modulator, 0).x > 1 ? texture(u_modulator, v_uv) : texture(u_orig, v_uv);
  float m;
  if (u_driver == 0) {
    m = luma(driverSrc.rgb);
  } else if (u_driver == 1) {
    m = 1.0 - luma(driverSrc.rgb);
  } else if (u_driver == 2) {
    m = driverSrc.r;
  } else if (u_driver == 3) {
    m = driverSrc.g;
  } else if (u_driver == 4) {
    m = driverSrc.b;
  } else {
    float hi = max(driverSrc.r, max(driverSrc.g, driverSrc.b));
    float lo = min(driverSrc.r, min(driverSrc.g, driverSrc.b));
    m = hi > 0.001 ? (hi - lo) / hi : 0.0;
  }
  // A keyed-out pixel drives nothing, whatever colour is left under it.
  m = clamp(m, 0.0, 1.0) * driverSrc.a;
`;

/** The scan position of this pixel, and a way back to a texel from one. */
const SCAN_AXIS = `  ivec2 here = ivec2(floor(v_uv * u_resolution));
  int i = u_axis == 0 ? here.x : here.y;
`;
const AT = (index: string) => `(u_axis == 0 ? ivec2(${index}, here.y) : ivec2(here.x, ${index}))`;

const INTEGRAND = `${DRIVER}
  float rowLength = u_axis == 0 ? u_resolution.x : u_resolution.y;
  float rate = max(u_carrier + u_depth * m, 0.0) / rowLength;
  fragColor = vec4(rate, 0.0, 0.0, 1.0);`;

const LOCAL_SCAN = `${SCAN_AXIS}
  int start = (i / ${BLOCK}) * ${BLOCK};
  float sum = 0.0;
  for (int k = 0; k < ${BLOCK}; k++) {
    int j = start + k;
    if (j > i) break;
    sum += texelFetch(u_src, ${AT('j')}, 0).r;
  }
  // R: running phase within the block, mod 1. G: this pixel's own rate,
  // carried on for the render pass.
  fragColor = vec4(fract(sum), texelFetch(u_src, here, 0).r, 0.0, 1.0);`;

const BLOCK_SCAN = `${SCAN_AXIS}
  vec4 local = texelFetch(u_src, here, 0);
  float sum = local.r;
  int block = i / ${BLOCK};
  for (int b = 0; b < ${MAX_BLOCKS}; b++) {
    if (b >= block) break;
    sum += texelFetch(u_src, ${AT(`b * ${BLOCK} + ${BLOCK - 1}`)}, 0).r;
  }
  fragColor = vec4(fract(sum), local.g, 0.0, 1.0);`;

const RENDER = `  vec4 data = texelFetch(u_src, ivec2(floor(v_uv * u_resolution)), 0);
  float rate = data.g;
  // The sum is inclusive; step back half a pixel to read the phase at the
  // pixel's centre.
  float phase = data.r - 0.5 * rate - u_phase_speed;
  float duty = clamp(u_duty, 0.02, 0.98);

  float wave = 0.0;
  if (u_waveform == 0) {
    // Hairline: lit only where the phase crosses a whole cycle inside this
    // pixel. The stored sum is the phase at the pixel's far edge, so the
    // fraction past the last crossing over the rate is how many pixels ago
    // that crossing was. One pixel wide and full strength whatever the
    // density; where there is more than one crossing a pixel, solid.
    float since = fract(data.r - u_phase_speed) / max(rate, 1e-6);
    wave = clamp(max(u_width, 1.0) - floor(since), 0.0, 1.0);
  } else {
    // Box-filter the wave over the pixel's footprint along the scan, so lines
    // too dense to draw settle to the tint they would make instead of
    // aliasing. The rate is known exactly -- it is the frequency -- so this
    // needs no derivatives, which would spike where the stored phase wraps.
    float footprint = min(rate, 1.0);
    for (int k = 0; k < 8; k++) {
      float p = phase + (float(k) + 0.5 - 4.0) / 8.0 * footprint;
      float f = fract(p);
      float w;
      if (u_waveform == 1) {
        w = smoothstep(1.0 - duty, 1.0, 0.5 + 0.5 * cos(TAU * p));
      } else if (u_waveform == 2) {
        w = step(1.0 - duty, f);
      } else {
        w = pow(f, 0.5 / duty);
      }
      wave += w;
    }
    wave /= 8.0;
  }

${DRIVER}
  // With Carrier near zero, a black driver stops the phase moving and a
  // crest can sit there as a solid band; the mask fades it out.
  float intensity = clamp(mix(wave, wave * m, u_lumMask), 0.0, 1.0);
  vec4 src = texture(u_orig, v_uv);
  vec3 ink = u_output == 0 ? u_lineColor : src.rgb * u_lineColor;
  fragColor = vec4(mix(u_bgColor, ink, intensity), src.a);`;

export const fmScanlines: EffectDef = {
  id: 'fmScanlines',
  label: 'Frequency Modulation',
  category: 'crt',
  animated: (params) => params.speed !== 0,
  mixable: true,
  scratch: 'float',
  inputs: [{ key: 'modulator', label: 'Modulator' }],
  params: [
    { kind: 'float', key: 'carrier', label: 'Carrier', min: 0, max: 160, step: 0.1, default: 35 },
    { kind: 'float', key: 'depth', label: 'Depth', min: 0, max: 300, step: 1, default: 90 },
    {
      kind: 'enum',
      key: 'driver',
      label: 'Driver',
      options: ['Luminance', 'Inverted Luma', 'Red', 'Green', 'Blue', 'Saturation'],
      default: 0,
    },
    /** Named for the lines drawn: vertical lines are a scan along each row. */
    { kind: 'enum', key: 'axis', label: 'Axis', options: ['Vertical Lines', 'Horizontal Lines'], default: 0 },
    { kind: 'enum', key: 'waveform', label: 'Waveform', options: ['Hairline', 'Sine', 'Pulse', 'Saw'], default: 0 },
    /** Hairline only: pixels per line. */
    {
      kind: 'float',
      key: 'width',
      label: 'Line Width',
      min: 1,
      max: 8,
      step: 0.5,
      default: 1,
      activeWhen: (params) => (params.waveform ?? 0) === 0,
    },
    /** Sine, Pulse and Saw: share of each cycle that is line. */
    {
      kind: 'float',
      key: 'duty',
      label: 'Duty',
      min: 0.05,
      max: 0.95,
      step: 0.01,
      default: 0.5,
      activeWhen: (params) => (params.waveform ?? 0) !== 0,
    },
    { kind: 'float', key: 'lumMask', label: 'Luma Mask', min: 0, max: 1, step: 0.01, default: 0 },
    { kind: 'float', key: 'speed', label: 'Drift', min: -2, max: 2, step: 0.01, default: 0 },
    { kind: 'enum', key: 'output', label: 'Output', options: ['Lines', 'Source Colour'], default: 0 },
    { kind: 'color', key: 'lineColor', label: 'Line Color', default: [1, 1, 1] },
    { kind: 'color', key: 'bgColor', label: 'Background', default: [0, 0, 0] },
  ],
  fragment: [INTEGRAND, LOCAL_SCAN, BLOCK_SCAN, RENDER],
};

/**
 * The same phase on the CPU, for one row of driver values: what the scan
 * passes compute, at the centre of each pixel, before any wrap. Kept next
 * to the shader so the tests can pin down what "true FM" means.
 */
export const fmPhase = (driver: readonly number[], carrier: number, depth: number): number[] => {
  const phases: number[] = [];
  let sum = 0;
  for (const m of driver) {
    const rate = Math.max(carrier + depth * m, 0) / driver.length;
    sum += rate;
    phases.push(sum - 0.5 * rate);
  }
  return phases;
};
