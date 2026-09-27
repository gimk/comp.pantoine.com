/**
 * The arithmetic of exporting, kept free of the DOM and the GPU so it can be
 * tested on its own.
 */

/**
 * GIF frame delays, in milliseconds, one per frame.
 *
 * The format stores delays in whole centiseconds, so 30fps -- 3.33cs a frame
 * -- cannot be written as it is. Rounding every frame to 3cs plays the GIF
 * 10% fast; rounding each frame's *end time* instead and taking differences
 * spreads the error out (3, 3, 4, 3, 3, 4 ...) so the total always matches
 * the duration to within a centisecond.
 *
 * Browsers treat a delay under 2cs as "unspecified" and substitute 10cs, so
 * no frame is given less than 2cs. At 50fps and below that never bites;
 * above it the caller should render fewer frames (see GIF_MAX_FPS).
 */
export const gifFrameDelays = (fps: number, count: number): number[] => {
  const delays: number[] = [];
  const frameCs = 100 / fps;
  let written = 0;
  for (let i = 0; i < count; i++) {
    const end = Math.round((i + 1) * frameCs);
    const delay = Math.max(2, end - written);
    delays.push(delay * 10);
    written += delay;
  }
  return delays;
};

/** Fastest frame rate a GIF can actually play at (2cs a frame). */
export const GIF_MAX_FPS = 50;

/**
 * Most pixels -- frames times frame area -- a GIF export will take on.
 * Quantising and encoding run on the main thread at roughly this many
 * pixels a few seconds per hundred million, and the encoded file grows
 * with them; beyond this the export is minutes long and the file is too big
 * to be a sensible GIF anyway.
 */
export const GIF_PIXEL_BUDGET = 150_000_000;

/** Why a GIF of this size will not be attempted, or null if it is fine. */
export const gifBudgetError = (
  width: number,
  height: number,
  frames: number,
  budget: number = GIF_PIXEL_BUDGET,
): string | null => {
  const pixels = width * height * frames;
  if (pixels <= budget) return null;
  const megapixels = (n: number) => Math.round(n / 1e6);
  return (
    `This GIF would be ${frames} frames at ${width}×${height} (${megapixels(pixels)} MP in total), ` +
    `more than the ${megapixels(budget)} MP a GIF export allows. ` +
    `Lower the render scale, the duration or the frame rate, or export MP4/WebM instead.`
  );
};

/**
 * Output size for a source at a render scale. Video encoders want even
 * dimensions (4:2:0 chroma is subsampled in pairs), so `even` rounds down
 * to the nearest even number, never below 2.
 */
export const outputSize = (
  sourceWidth: number,
  sourceHeight: number,
  scale: number,
  even = false,
): { width: number; height: number } => {
  const fit = (n: number): number => {
    const scaled = Math.max(1, Math.round(n * scale));
    return even ? Math.max(2, scaled - (scaled % 2)) : scaled;
  };
  return { width: fit(sourceWidth), height: fit(sourceHeight) };
};

/**
 * How a video node's playback speed setting maps to what the element can
 * actually do -- the same clamping the viewer applies, so an export plays at
 * the speed the preview did. Below 0.001 counts as stopped.
 */
export const effectivePlaybackRate = (speed: number): number =>
  !(speed > 0.001) ? 0 : Math.min(16, Math.max(0.0625, speed));

/**
 * Where in a video to be, given how far into it playback has carried
 * (`position`, in video seconds). Looping wraps; otherwise it holds on the
 * last frame, a hair before the end so there still is a frame to show.
 */
export const videoPosition = (position: number, duration: number, loop: boolean): number => {
  if (!(duration > 0)) return Math.max(0, position);
  const last = Math.max(0, duration - 0.001);
  if (!loop) return Math.min(Math.max(0, position), last);
  const wrapped = position % duration;
  return Math.min(wrapped < 0 ? wrapped + duration : wrapped, last);
};

/**
 * Warm-up for feedback: how many frames to render before the first captured
 * one, so trails and echoes arrive already built up rather than starting
 * from black. Never reaches before time zero, where the preview starts too.
 */
export const warmUpFrames = (startTime: number, fps: number, seconds: number, maxFrames: number): number =>
  Math.max(0, Math.min(maxFrames, Math.round(Math.min(seconds, Math.max(0, startTime)) * fps)));
