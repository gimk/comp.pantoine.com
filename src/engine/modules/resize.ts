import type { EffectDef, ParamValue } from '../effects';
import type { Frame } from '../frames';

/**
 * Resize or crop: the one module that changes the picture's size.
 *
 * Every other module works inside the frame it is handed. This one makes
 * a new frame (see frames.ts), and everything after it on the main path --
 * and an export of it -- is that size and shape:
 *
 *   - Resize by a scale, to a width and height, or to a width or height
 *     with the shape kept. Given both and a new shape, Fit says what
 *     happens to the difference: stretch, fill and crop, or fit and leave
 *     transparent bars. Anchor says which part is kept or where it sits.
 *   - Crop to Aspect cuts the largest piece of a given shape out of the
 *     picture, from where Anchor says.
 *   - Crop Margins takes a share off each side.
 *
 * Sizes are source pixels, like every pixel param, so a 1080 x 1080
 * resize exports at 1080 x 1080 at render scale 1, whatever the preview
 * works at. They shape the plan rather than a frame of it, so they have
 * no port -- a wire could not resize the picture from one frame to the next.
 *
 * Shrinking averages every input pixel an output pixel covers, up to 4 x 4,
 * rather than sampling four of them, so fine detail resizes down to the tone
 * it averages to instead of breaking into moire.
 */

const ASPECTS: [number, number][] = [
  [1, 1],
  [4, 5],
  [9, 16],
  [16, 9],
  [4, 3],
  [3, 2],
  [21, 9],
];

const num = (params: Record<string, ParamValue>, key: string, fallback: number): number =>
  typeof params[key] === 'number' ? (params[key] as number) : fallback;

/** Margins as applied: each pair held to leave at least 5% of the picture. */
export const cropMargins = (params: Record<string, ParamValue>) => {
  const pair = (a: number, b: number): [number, number] => {
    const lo = Math.min(Math.max(a, 0), 0.95);
    const hi = Math.min(Math.max(b, 0), 0.95);
    const total = lo + hi;
    return total > 0.95 ? [(lo * 0.95) / total, (hi * 0.95) / total] : [lo, hi];
  };
  const [left, right] = pair(num(params, 'left', 0), num(params, 'right', 0));
  const [top, bottom] = pair(num(params, 'top', 0), num(params, 'bottom', 0));
  return { left, right, top, bottom };
};

export const resizeFrame = (input: Frame, params: Record<string, ParamValue>): Frame => {
  const mode = num(params, 'mode', 0);
  const { width: w, height: h } = input;
  if (mode === 1) {
    const [aw, ah] = ASPECTS[num(params, 'aspect', 0)] ?? ASPECTS[0];
    const ratio = aw / ah;
    return w / h > ratio ? { width: h * ratio, height: h } : { width: w, height: w / ratio };
  }
  if (mode === 2) {
    const m = cropMargins(params);
    return { width: w * (1 - m.left - m.right), height: h * (1 - m.top - m.bottom) };
  }
  const width = Math.max(1, num(params, 'width', w));
  const height = Math.max(1, num(params, 'height', h));
  switch (num(params, 'sizeBy', 0)) {
    case 1:
      return { width, height };
    case 2:
      return { width, height: (width * h) / w };
    case 3:
      return { width: (height * w) / h, height };
    default: {
      const scale = Math.max(0.01, num(params, 'scale', 1));
      return { width: w * scale, height: h * scale };
    }
  }
};

const isMode = (mode: number) => (params: Record<string, ParamValue>) => (params.mode ?? 0) === mode;
const sizedBy =
  (...ways: number[]) =>
  (params: Record<string, ParamValue>) =>
    (params.mode ?? 0) === 0 && ways.includes((params.sizeBy as number) ?? 0);
/** Only a new width and height together can change the shape. */
const reshapes = sizedBy(1);

export const resize: EffectDef = {
  id: 'resize',
  label: 'Resize / Crop',
  category: 'geometry',
  animated: false,
  frame: resizeFrame,
  params: [
    {
      kind: 'enum',
      key: 'mode',
      label: 'Mode',
      options: ['Resize', 'Crop to Aspect', 'Crop Margins'],
      default: 0,
      portless: true,
    },
    {
      kind: 'enum',
      key: 'sizeBy',
      label: 'Size By',
      options: ['Scale', 'Width & Height', 'Width', 'Height'],
      default: 0,
      portless: true,
      activeWhen: isMode(0),
    },
    {
      kind: 'float',
      key: 'scale',
      label: 'Scale',
      min: 0.05,
      max: 4,
      step: 0.01,
      default: 1,
      portless: true,
      activeWhen: sizedBy(0),
    },
    {
      kind: 'float',
      key: 'width',
      label: 'Width',
      min: 1,
      max: 16384,
      step: 1,
      default: 1920,
      field: true,
      portless: true,
      activeWhen: sizedBy(1, 2),
    },
    {
      kind: 'float',
      key: 'height',
      label: 'Height',
      min: 1,
      max: 16384,
      step: 1,
      default: 1080,
      field: true,
      portless: true,
      activeWhen: sizedBy(1, 3),
    },
    {
      kind: 'enum',
      key: 'fit',
      label: 'Fit',
      options: ['Stretch', 'Fill (Crop)', 'Fit (Bars)'],
      default: 1,
      activeWhen: reshapes,
    },
    {
      kind: 'enum',
      key: 'aspect',
      label: 'Aspect',
      options: ASPECTS.map(([w, h]) => `${w}:${h}`),
      default: 0,
      portless: true,
      activeWhen: isMode(1),
    },
    {
      kind: 'vec2',
      key: 'anchor',
      label: 'Anchor',
      min: -1,
      max: 1,
      step: 0.01,
      default: [0, 0],
      activeWhen: (params) => isMode(1)(params) || (reshapes(params) && (params.fit ?? 1) !== 0),
    },
    ...(['left', 'right', 'top', 'bottom'] as const).map((key) => ({
      kind: 'float' as const,
      key,
      label: key[0].toUpperCase() + key.slice(1),
      min: 0,
      max: 0.95,
      step: 0.005,
      default: 0,
      portless: true,
      activeWhen: isMode(2),
    })),
  ],
  fragment: `  // Where the output's (0..1) square lands in the input's: src = offset + uv * span.
  vec2 offset = vec2(0.0);
  vec2 span = vec2(1.0);
  bool bars = false;
  float inRatio = u_input_frame.x / max(u_input_frame.y, 1.0);
  float outRatio = u_resolution.x / max(u_resolution.y, 1.0);

  if (u_mode == 2) {
    // Margins, held as resizeFrame holds them. v runs up, so Bottom is
    // where v starts.
    vec2 lr = vec2(clamp(u_left, 0.0, 0.95), clamp(u_right, 0.0, 0.95));
    vec2 tb = vec2(clamp(u_top, 0.0, 0.95), clamp(u_bottom, 0.0, 0.95));
    lr *= min(1.0, 0.95 / max(lr.x + lr.y, 1e-6));
    tb *= min(1.0, 0.95 / max(tb.x + tb.y, 1e-6));
    offset = vec2(lr.x, tb.y);
    span = vec2(1.0 - lr.x - lr.y, 1.0 - tb.x - tb.y);
  } else {
    // Crop to Aspect is a fill; a resize that keeps the shape is a stretch
    // that changes nothing but the size.
    int fit = u_mode == 1 ? 1 : (u_sizeBy == 1 ? u_fit : 0);
    if (fit != 0) {
      // Share of the input shown on each axis: under 1 where a fill crops,
      // over 1 where a fit leaves bars.
      span = inRatio > outRatio ? vec2(outRatio / inRatio, 1.0) : vec2(1.0, inRatio / outRatio);
      if (fit == 2) span = inRatio > outRatio ? vec2(1.0, inRatio / outRatio) : vec2(outRatio / inRatio, 1.0);
      bars = fit == 2;
      // Anchor -1..1 slides the window from one edge to the other.
      offset = (1.0 - span) * (clamp(u_anchor, -1.0, 1.0) + 1.0) * 0.5;
    }
  }

  // Average every input texel this output pixel covers, up to 4 x 4.
  vec2 pixel = span / u_resolution;
  vec2 texels = pixel * vec2(textureSize(u_src, 0));
  ivec2 taps = ivec2(clamp(ceil(texels), 1.0, 4.0));
  vec4 sum = vec4(0.0);
  for (int j = 0; j < 4; j++) {
    if (j >= taps.y) break;
    for (int i = 0; i < 4; i++) {
      if (i >= taps.x) break;
      vec2 sub = (vec2(float(i), float(j)) + 0.5) / vec2(taps) - 0.5;
      vec2 src = offset + v_uv * span + sub * pixel;
      bool outside = any(lessThan(src, vec2(0.0))) || any(greaterThan(src, vec2(1.0)));
      sum += bars && outside ? vec4(0.0) : texture(u_src, src);
    }
  }
  fragColor = sum / float(taps.x * taps.y);`,
};
