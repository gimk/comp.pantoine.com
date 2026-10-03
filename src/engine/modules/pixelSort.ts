import type { EffectDef } from '../effects';

/**
 * Pixel sorting: runs of pixels whose value falls in a range are sorted
 * along the row (or column), the rest left where they are.
 *
 * Done exactly, on the GPU, in one frame, as a chain of passes over a float
 * scratch picture holding (segment start, original index, key, in range)
 * per pixel:
 *
 *  1. Init -- each pixel's key, and whether it starts a run: its own index
 *     where its in-range state differs from the pixel before, else -1.
 *  2. Scan -- a running max with doubling steps, after which every pixel
 *     holds the start of its run. The last step cuts runs into Max Length
 *     pieces, and gives each pixel outside the range a segment of its own.
 *  3. Sort -- a bitonic network over the whole row, ordering by (segment
 *     start, key, original index). Segments are contiguous and already in
 *     order, so sorting by their start first keeps every pixel inside its
 *     own run. It is the all-ascending variant, where a position past the
 *     end of the row counts as +infinity and so never has to be stored --
 *     which is what lets a width that is not a power of two sort.
 *  4. Resolve -- each pixel fetches the colour its sorted entry came from.
 *
 * The network is sized for rows up to 4096 pixels; longer rows sort in
 * 4096-pixel pieces. Every pass reads its step from `u_pass`, so all of
 * them are the same text and the pipeline compiles it once. Indices are
 * exact in full float; on a GPU with only half-float targets they are exact
 * up to 2048, beyond which long rows sort slightly out of place.
 */

/** log2 of the longest row the network sorts in one piece. */
export const SORT_LOG = 12;
const SORT_SIZE = 1 << SORT_LOG;
/** Bitonic steps: stage k has k + 1 of them. */
export const SORT_STEPS = (SORT_LOG * (SORT_LOG + 1)) / 2;
const SCAN_FIRST = 1;
const SORT_FIRST = SCAN_FIRST + SORT_LOG;
const RESOLVE = SORT_FIRST + SORT_STEPS;

/**
 * Which stage and step of the network sort pass `t` is. Step `stage` is the
 * flip -- each block compared with its own mirror image -- and the steps
 * after it halve the stride down to 1. The shader does the same arithmetic.
 */
export const sortStep = (t: number): { stage: number; step: number } => {
  let stage = 0;
  while (t > stage) {
    t -= stage + 1;
    stage += 1;
  }
  return { stage, step: stage - t };
};

/** The position `local` is compared with at a given stage and step. */
export const sortPartner = (local: number, stage: number, step: number): number =>
  step === stage ? local ^ ((2 << stage) - 1) : local ^ (1 << step);

/** The texel at position `index` along this pixel's row or column. */
const AT = (index: string) =>
  `(vertical ? ivec2(across, size.y - 1 - (${index})) : ivec2(${index}, across))`;

const BODY = `  bool vertical = u_direction == 1;
  ivec2 size = ivec2(u_resolution);
  int n = vertical ? size.y : size.x;
  ivec2 here = ivec2(floor(v_uv * u_resolution));
  // Columns run top to bottom, so ascending starts at the top as it reads.
  int along = vertical ? size.y - 1 - here.y : here.x;
  int across = vertical ? here.x : here.y;
  int base = along - along % ${SORT_SIZE};
  int local = along - base;

  if (u_pass == 0) {
    bool inRange[2];
    float keyHere = 0.0;
    for (int k = 0; k < 2; k++) {
      int i = max(along - k, 0);
      vec3 c = texelFetch(u_src, ${AT('i')}, 0).rgb;
      float hi = max(c.r, max(c.g, c.b));
      float lo = min(c.r, min(c.g, c.b));
      float chroma = hi - lo;
      float v;
      if (u_sortBy == 0) v = luma(c);
      else if (u_sortBy == 1) {
        float h = 0.0;
        if (chroma > 0.0) {
          if (hi == c.r) h = mod((c.g - c.b) / chroma, 6.0);
          else if (hi == c.g) h = (c.b - c.r) / chroma + 2.0;
          else h = (c.r - c.g) / chroma + 4.0;
        }
        v = h / 6.0;
      }
      else if (u_sortBy == 2) v = hi > 0.0 ? chroma / hi : 0.0;
      else if (u_sortBy == 3) v = c.r;
      else if (u_sortBy == 4) v = c.g;
      else v = c.b;
      inRange[k] = (v >= u_lower && v <= u_upper) != u_invert;
      if (k == 0) keyHere = v;
    }
    bool starts = local == 0 || inRange[0] != inRange[1];
    fragColor = vec4(starts ? float(along) : -1.0, float(along), u_order == 1 ? -keyHere : keyHere, inRange[0] ? 1.0 : 0.0);
  } else if (u_pass < ${SORT_FIRST}) {
    vec4 self = texelFetch(u_src, ${AT('along')}, 0);
    int stride = 1 << (u_pass - ${SCAN_FIRST});
    if (local >= stride) self.r = max(self.r, texelFetch(u_src, ${AT('along - stride')}, 0).r);
    if (u_pass == ${SORT_FIRST - 1}) {
      // Every pixel now holds its run's start: cut runs to Max Length, and
      // give a pixel outside the range a segment of its own so it stays put.
      int run = int(self.r);
      int len = max(int(round(u_maxLength * u_pixel_scale)), 1);
      self.r = self.a > 0.5 ? float(run + ((along - run) / len) * len) : float(along);
    }
    fragColor = self;
  } else if (u_pass < ${RESOLVE}) {
    int t = u_pass - ${SORT_FIRST};
    int stage = 0;
    while (t > stage) {
      t -= stage + 1;
      stage += 1;
    }
    int sub = stage - t;
    int partner = sub == stage ? local ^ ((2 << stage) - 1) : local ^ (1 << sub);
    vec4 self = texelFetch(u_src, ${AT('along')}, 0);
    // Past the end of the row is +infinity, and only ever the higher of a
    // pair: keeping the minimum there leaves this pixel where it is.
    if (base + partner >= n || partner >= ${SORT_SIZE}) {
      fragColor = self;
    } else {
      vec4 other = texelFetch(u_src, ${AT('base + partner')}, 0);
      bool otherFirst = other.r != self.r ? other.r < self.r
        : other.b != self.b ? other.b < self.b
        : other.g < self.g;
      bool keepLower = local < partner;
      fragColor = (keepLower == otherFirst) ? other : self;
    }
  } else {
    int from = int(texelFetch(u_src, ${AT('along')}, 0).g + 0.5);
    fragColor = texelFetch(u_orig, ${AT('from')}, 0);
  }`;

export const pixelSort: EffectDef = {
  id: 'pixelSort',
  label: 'Pixel Sort',
  category: 'tape',
  animated: false,
  mixable: true,
  scratch: 'float',
  params: [
    { kind: 'enum', key: 'direction', label: 'Direction', options: ['Horizontal', 'Vertical'], default: 0 },
    {
      kind: 'enum',
      key: 'sortBy',
      label: 'Sort By',
      options: ['Brightness', 'Hue', 'Saturation', 'Red', 'Green', 'Blue'],
      default: 0,
    },
    { kind: 'enum', key: 'order', label: 'Order', options: ['Ascending', 'Descending'], default: 0 },
    { kind: 'float', key: 'lower', label: 'Lower', min: 0, max: 1, step: 0.01, default: 0.25 },
    { kind: 'float', key: 'upper', label: 'Upper', min: 0, max: 1, step: 0.01, default: 0.8 },
    { kind: 'bool', key: 'invert', label: 'Invert Range', default: false },
    { kind: 'float', key: 'maxLength', label: 'Max Length', min: 1, max: 4096, step: 1, default: 4096 },
  ],
  fragment: new Array<string>(RESOLVE + 1).fill(BODY),
};
