import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { generatorsForPlan, type ExportFormat, type RenderNodeData, type ResolvedChain } from '../state/graph';
import { useGraph } from '../state/store';
import { Pipeline } from './pipeline';
import { createContext } from './gl';
import { getImage, type LoadedImage } from './imageStore';
import { getVideo, type LoadedVideo } from './videoStore';
import { evaluateSignal, signalIsMoving, signalKey, type Signal } from './modulators';
import { PhaseIntegrator } from './phase';
import { imagesForPlan, videosForPlan } from './planMedia';
import {
  GIF_MAX_FPS,
  effectivePlaybackRate,
  gifBudgetError,
  gifFrameDelays,
  outputSize,
  videoPosition,
  warmUpFrames,
} from './exportMath';

export type ExportProgress = {
  currentFrame: number;
  totalFrames: number;
  percent: number;
};

export type ProgressCallback = (progress: ExportProgress) => void;

export type ExportOptions = {
  chain: ResolvedChain;
  data: RenderNodeData;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
};

export type ExportResult = {
  blob: Blob;
  /** The container actually produced, which can differ from the one asked for. */
  extension: string;
  width: number;
  height: number;
};

/** Seconds of feedback history rendered before the first captured frame. */
const WARM_UP_SECONDS = 2;
const MAX_WARM_UP_FRAMES = 120;
/** Frame rate warm-up runs at for a still, which has no frame rate of its own. */
const STILL_WARM_UP_FPS = 30;
/** How long one video seek may take before the export gives up on it. */
const SEEK_TIMEOUT_MS = 10_000;
/** How long a private copy of a video may take to become decodable. */
const LOAD_TIMEOUT_MS = 20_000;

/** Trigger a browser file download for a Blob. */
export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Generate a meaningful filename for an exported asset. */
export const getExportFilename = (
  primaryImageName: string | undefined,
  format: ExportFormat,
  actualExtension?: string,
): string => {
  const base = primaryImageName
    ? primaryImageName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_')
    : 'comp';
  const ext = actualExtension ?? (format === 'jpg' ? 'jpg' : format);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${base}_${timestamp}.${ext}`;
};

/** Check supported video MIME type for MP4 or WebM. */
export const getSupportedVideoMimeType = (
  format: 'mp4' | 'webm',
): { mimeType: string; extension: string } | null => {
  if (typeof MediaRecorder === 'undefined') return null;

  if (format === 'mp4') {
    const candidates = [
      'video/mp4; codecs="avc1.42E01E"',
      'video/mp4; codecs="avc1.4D401E"',
      'video/mp4',
    ];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return { mimeType: c, extension: 'mp4' };
    }
    // Fall back to WebM if MP4 recording is unsupported in this browser
    if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
      return { mimeType: 'video/webm; codecs=vp9', extension: 'webm' };
    }
    if (MediaRecorder.isTypeSupported('video/webm')) {
      return { mimeType: 'video/webm', extension: 'webm' };
    }
  } else {
    const candidates = ['video/webm; codecs=vp9', 'video/webm; codecs=vp8', 'video/webm'];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return { mimeType: c, extension: 'webm' };
    }
  }
  return null;
};

/* ------------------------------------------------------------------ */
/* Small async helpers                                                 */
/* ------------------------------------------------------------------ */

const abortError = (): Error => {
  const error = new Error('Export cancelled');
  error.name = 'AbortError';
  return error;
};

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError();
};

/**
 * Let the page breathe between frames. A message round trip rather than
 * setTimeout(0): timers in a background tab are throttled to one a second
 * or worse, which would turn a thirty-second export into a half-hour one
 * the moment the user switched tabs.
 */
const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Wait for `ready()` to hold, re-checking on each of `events`, with a
 * timeout and abort. The shared skeleton of loading and seeking.
 */
const waitForVideo = (
  video: HTMLVideoElement,
  events: string[],
  ready: () => boolean,
  timeoutMessage: string,
  timeoutMs: number,
  signal?: AbortSignal,
  start?: () => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const name of events) video.removeEventListener(name, onEvent);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onEvent = () => {
      if (ready()) finish();
    };
    const onError = () => finish(new Error('A video input could not be decoded for export.'));
    const onAbort = () => finish(abortError());
    const timer = setTimeout(() => finish(new Error(timeoutMessage)), timeoutMs);
    for (const name of events) video.addEventListener(name, onEvent);
    video.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    start?.();
    if (signal?.aborted) onAbort();
    else if (!start && ready()) finish();
  });

/**
 * Seek, and resolve once the frame at the new position can actually be
 * uploaded.
 *
 * `seeked` alone is not quite that: some browsers fire it before the new
 * frame has been decoded, and a texture upload at that moment gets the old
 * one. `requestVideoFrameCallback` fires when the new frame is ready, so it
 * is preferred where it exists -- with a short grace period after `seeked`,
 * because a detached element is not always "rendered" enough for the
 * callback to come at all.
 */
const seekFrame = (video: HTMLVideoElement, target: number, signal?: AbortSignal): Promise<void> => {
  throwIfAborted(signal);
  if (Math.abs(video.currentTime - target) < 1e-6 && !video.seeking && video.readyState >= 2) {
    return Promise.resolve();
  }
  const withCallback = video as FrameCallbackVideo;
  let presented = false;
  let seeked = false;
  let handle: number | undefined;
  let graceElapsed = false;
  let grace: ReturnType<typeof setTimeout> | undefined;
  const canCallback = typeof withCallback.requestVideoFrameCallback === 'function';

  const ready = () =>
    video.readyState >= 2 && !video.seeking && seeked && (!canCallback || presented || graceElapsed);

  return waitForVideo(
    video,
    ['seeked', 'loadeddata', 'canplay', 'comp-export-frame'],
    ready,
    `Timed out seeking a video input to ${target.toFixed(2)}s.`,
    SEEK_TIMEOUT_MS,
    signal,
    () => {
      const poke = () => video.dispatchEvent(new Event('comp-export-frame'));
      if (canCallback) {
        handle = withCallback.requestVideoFrameCallback!(() => {
          presented = true;
          poke();
        });
      }
      video.addEventListener(
        'seeked',
        () => {
          seeked = true;
          poke();
          if (canCallback && !presented) {
            grace = setTimeout(() => {
              graceElapsed = true;
              poke();
            }, 250);
          }
        },
        { once: true, capture: true },
      );
      video.currentTime = target;
    },
  ).finally(() => {
    if (grace !== undefined) clearTimeout(grace);
    if (handle !== undefined && !presented) withCallback.cancelVideoFrameCallback?.(handle);
  });
};

/* ------------------------------------------------------------------ */
/* Video inputs                                                        */
/* ------------------------------------------------------------------ */

/**
 * A video input as the export sees it: its own element, and the mapping
 * from composition time to the position in the clip.
 */
type ExportVideo = {
  loaded: LoadedVideo;
  positionAt: (time: number) => number;
  dispose: () => void;
};

/**
 * A private element playing the same source as the node's.
 *
 * The node's own element belongs to the viewers, which keep playing and
 * seeking it; an export sharing it would fight them for the playhead and
 * leave every viewer wherever the export finished.
 */
const openExportVideo = async (
  nodeId: string,
  live: LoadedVideo,
  modulation: Record<string, Signal> | undefined,
  signal?: AbortSignal,
): Promise<ExportVideo> => {
  const src = live.element.currentSrc || live.element.src || live.url;
  if (!src) throw new Error('A video input has no source to export from.');

  const element = document.createElement('video');
  element.crossOrigin = 'anonymous';
  element.muted = true;
  element.playsInline = true;
  element.preload = 'auto';
  const dispose = () => {
    element.removeAttribute('src');
    element.load();
  };

  try {
    await waitForVideo(
      element,
      ['loadeddata', 'canplay'],
      () => element.readyState >= 2,
      'Timed out loading a video input for export.',
      LOAD_TIMEOUT_MS,
      signal,
      () => {
        element.src = src;
        element.load();
      },
    );
  } catch (error) {
    dispose();
    throw error;
  }

  // Speed and looping as the viewer applies them (see OutputNode's draw).
  const node = useGraph.getState().nodes.find((n) => n.id === nodeId);
  const settings = node?.type === 'video' ? node.data : undefined;
  const duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : live.duration;
  const loop = settings?.loop !== false;
  const speedSignal = modulation?.speed;
  const baseSpeed =
    typeof settings?.speed === 'number' ? settings.speed : typeof settings?.playbackRate === 'number' ? settings.playbackRate : 1;

  let progressAt: (time: number) => number;
  if (speedSignal && signalIsMoving(speedSignal)) {
    // A modulated speed: the position is its integral, like a phase.
    const integrator = new PhaseIntegrator();
    const identity = JSON.stringify(signalKey(speedSignal));
    progressAt = (time) =>
      integrator.integrate('speed', time, identity, (t) => effectivePlaybackRate(evaluateSignal(speedSignal, t)), Infinity);
  } else {
    const rate = effectivePlaybackRate(speedSignal ? evaluateSignal(speedSignal, 0) : baseSpeed);
    progressAt = (time) => Math.max(0, time) * rate;
  }

  return {
    loaded: { ...live, element, duration },
    positionAt: (time) => videoPosition(progressAt(time), duration, loop),
    dispose,
  };
};

/* ------------------------------------------------------------------ */
/* The session every export runs in                                   */
/* ------------------------------------------------------------------ */

/**
 * Everything an export needs set up: inputs gathered, an off-screen GL
 * context at the output size, a pipeline of its own, private video
 * elements -- and the checks that turn a GPU limit or a lost context into
 * an error message instead of a file of black frames.
 */
class ExportSession {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly width: number;
  readonly height: number;
  private pipeline: Pipeline;
  private videos = new Map<string, ExportVideo>();
  private frameCounter = 0;
  private lost = false;
  private onLost = () => {
    this.lost = true;
  };

  private constructor(
    private readonly options: ExportOptions,
    private readonly inputs: Inputs,
    canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
  ) {
    this.canvas = canvas;
    this.gl = gl;
    this.width = inputs.width;
    this.height = inputs.height;
    canvas.addEventListener('webglcontextlost', this.onLost);
    this.pipeline = new Pipeline(gl);
  }

  static async open(options: ExportOptions, inputs: Inputs): Promise<ExportSession> {
    throwIfAborted(options.signal);
    const { width, height } = inputs;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const gl = createContext(canvas, { preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 context could not be created');

    const release = () => gl.getExtension('WEBGL_lose_context')?.loseContext();
    try {
      checkGpuLimits(gl, inputs);
    } catch (error) {
      release();
      throw error;
    }

    let session: ExportSession;
    try {
      session = new ExportSession(options, inputs, canvas, gl);
    } catch (error) {
      release();
      throw error;
    }
    try {
      for (const [nodeId, live] of inputs.videos) {
        const video = await openExportVideo(nodeId, live, options.chain.videoModulation?.get(nodeId), options.signal);
        session.videos.set(nodeId, video);
      }
    } catch (error) {
      session.dispose();
      throw error;
    }
    return session;
  }

  private assertAlive(): void {
    if (this.lost || this.gl.isContextLost()) {
      throw new Error(
        'The GPU context was lost during export (the GPU may be out of memory). Try a lower render scale.',
      );
    }
  }

  /** Render the frame at `time` into the canvas. */
  async render(time: number, delta: number): Promise<void> {
    const { signal } = this.options;
    throwIfAborted(signal);
    this.assertAlive();

    await Promise.all(
      Array.from(this.videos.values(), (video) => seekFrame(video.loaded.element, video.positionAt(time), signal)),
    );
    throwIfAborted(signal);

    const videos = new Map<string, LoadedVideo>();
    for (const [nodeId, video] of this.videos) videos.set(nodeId, video.loaded);

    const { chain, data } = this.options;
    this.pipeline.render({
      plan: chain.plan,
      images: this.inputs.images,
      videos,
      generators: this.inputs.generators,
      primaryNodeId: chain.sourceNodeId,
      time,
      delta,
      frame: this.frameCounter,
      canvasWidth: this.width,
      canvasHeight: this.height,
      maxWorkingSize: Math.max(this.width, this.height),
      // Straight at the output size: effects scale their pixel params by
      // u_pixel_scale, so rendering big and shrinking would only cost time.
      workingScale: data.scale,
      // Cover rather than letterbox: an even-rounded video frame is at
      // most a pixel off the source's shape, and that pixel is cropped.
      fitMode: 'fill',
    });
    this.frameCounter += 1;
    this.assertAlive();
  }

  /**
   * Render, without capturing, the frames leading up to `start` at `fps`,
   * so feedback -- trails, echo, flames -- has its history when capture
   * begins, as it would in a preview that had been playing.
   */
  async warmUp(start: number, fps: number): Promise<void> {
    if (!this.inputs.needsWarmUp) return;
    const frames = warmUpFrames(start, fps, WARM_UP_SECONDS, MAX_WARM_UP_FRAMES);
    for (let k = frames; k >= 1; k--) {
      await this.render(start - k / fps, 1 / fps);
      await yieldToEventLoop();
    }
  }

  dispose(): void {
    for (const video of this.videos.values()) video.dispose();
    this.videos.clear();
    this.pipeline.dispose();
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

type Inputs = {
  images: Map<string, LoadedImage>;
  videos: Map<string, LoadedVideo>;
  generators: Map<string, { width: number; height: number }>;
  /** The source that sets the frame's shape. */
  source: { width: number; height: number };
  scale: number;
  width: number;
  height: number;
  needsWarmUp: boolean;
};

/** Everything the chain reads, and the output size -- before any GPU work. */
const gatherInputs = (chain: ResolvedChain, data: RenderNodeData, even: boolean): Inputs => {
  const generators = generatorsForPlan(chain.plan);
  const source = getImage(chain.sourceNodeId) ?? getVideo(chain.sourceNodeId) ?? generators.get(chain.sourceNodeId);
  if (!source) throw new Error('Source media not loaded');
  const images = imagesForPlan(chain.plan);
  const videos = videosForPlan(chain.plan);
  if (!images || !videos) throw new Error('Missing input media in chain');
  if (!(data.scale > 0)) throw new Error('Render scale must be above zero.');

  const { width, height } = outputSize(source.width, source.height, data.scale, even);
  const needsWarmUp = chain.passes.some((pass) => pass.def.feedback || pass.def.id === 'particleFlow');
  return {
    images,
    videos,
    generators,
    source: { width: source.width, height: source.height },
    scale: data.scale,
    width,
    height,
    needsWarmUp,
  };
};

/**
 * Refuse, up front and in words, what the GPU cannot do. Past these limits
 * WebGL does not throw -- allocations just fail and the export comes out
 * black.
 */
const checkGpuLimits = (gl: WebGL2RenderingContext, inputs: Inputs): void => {
  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const maxRenderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  const limit = Math.min(maxTexture, maxRenderbuffer, viewport[0], viewport[1]);
  // The working size can be a pixel over the output after even-rounding.
  const workWidth = Math.max(inputs.width, Math.round(inputs.source.width * inputs.scale));
  const workHeight = Math.max(inputs.height, Math.round(inputs.source.height * inputs.scale));
  if (workWidth > limit || workHeight > limit) {
    throw new Error(
      `The output would be ${inputs.width}×${inputs.height}, but this GPU can render at most ${limit}px per side. ` +
        `Lower the render scale.`,
    );
  }
  for (const image of inputs.images.values()) {
    if (image.width > maxTexture || image.height > maxTexture) {
      throw new Error(
        `An image input is ${image.width}×${image.height}, larger than this GPU's ${maxTexture}px texture limit.`,
      );
    }
  }
  for (const video of inputs.videos.values()) {
    if (video.width > maxTexture || video.height > maxTexture) {
      throw new Error(
        `A video input is ${video.width}×${video.height}, larger than this GPU's ${maxTexture}px texture limit.`,
      );
    }
  }
};

/** Open a session, run `body` in it, and always tear it down. */
const withSession = async <T>(
  options: ExportOptions,
  inputs: Inputs,
  body: (session: ExportSession) => Promise<T>,
): Promise<T> => {
  const session = await ExportSession.open(options, inputs);
  try {
    return await body(session);
  } finally {
    session.dispose();
  }
};

const frameRate = (data: RenderNodeData): number => Math.min(120, Math.max(1, Number(data.fps) || 30));
const frameCount = (data: RenderNodeData, fps: number): number =>
  Math.max(1, Math.round(Math.max(0, Number(data.duration) || 0) * fps));

const progress = (onProgress: ProgressCallback | undefined, currentFrame: number, totalFrames: number): void =>
  onProgress?.({ currentFrame, totalFrames, percent: Math.round((currentFrame / totalFrames) * 100) });

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

/** Export a single still frame as PNG or JPG. */
export const exportStill = async (options: ExportOptions): Promise<ExportResult> => {
  const { chain, data, signal, onProgress } = options;
  const inputs = gatherInputs(chain, data, false);

  return withSession(options, inputs, async (session) => {
    await session.warmUp(data.time, STILL_WARM_UP_FPS);
    await session.render(data.time, 1 / STILL_WARM_UP_FPS);

    const isJpg = data.format === 'jpg';
    const mimeType = isJpg ? 'image/jpeg' : 'image/png';
    const blob = await new Promise<Blob>((resolve, reject) => {
      session.canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to create image blob'));
        },
        mimeType,
        isJpg ? data.quality : undefined,
      );
    });
    throwIfAborted(signal);
    progress(onProgress, 1, 1);
    return { blob, extension: isJpg ? 'jpg' : 'png', width: session.width, height: session.height };
  });
};

/** Export an animated GIF using gifenc. */
export const exportGif = async (options: ExportOptions): Promise<ExportResult> => {
  const { chain, data, signal, onProgress } = options;
  const inputs = gatherInputs(chain, data, false);
  // A GIF cannot play faster than 50fps; render only the frames it can show.
  const fps = Math.min(frameRate(data), GIF_MAX_FPS);
  const totalFrames = frameCount(data, fps);
  const budget = gifBudgetError(inputs.width, inputs.height, totalFrames);
  if (budget) throw new Error(budget);

  return withSession(options, inputs, async (session) => {
    const { gl, width, height } = session;
    await session.warmUp(data.time, fps);

    const gif = GIFEncoder();
    const maxColors = Math.max(16, Math.min(256, Math.round(data.quality * 240 + 16)));
    const rgba = new Uint8Array(width * height * 4);
    const flipped = new Uint8Array(width * height * 4);
    const rowBytes = width * 4;
    const delays = gifFrameDelays(fps, totalFrames);

    for (let f = 0; f < totalFrames; f++) {
      await session.render(data.time + f / fps, 1 / fps);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);

      // Flip vertically: WebGL is bottom-to-top, GIF expects top-to-bottom
      for (let y = 0; y < height; y++) {
        const srcOffset = y * rowBytes;
        const dstOffset = (height - 1 - y) * rowBytes;
        flipped.set(rgba.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
      }

      const palette = quantize(flipped, maxColors, { format: 'rgb565' });
      const index = applyPalette(flipped, palette, 'rgb565');
      gif.writeFrame(index, width, height, { palette, delay: delays[f], repeat: 0 });

      progress(onProgress, f + 1, totalFrames);
      await yieldToEventLoop();
      throwIfAborted(signal);
    }

    gif.finish();
    const blob = new Blob([gif.bytes()], { type: 'image/gif' });
    return { blob, extension: 'gif', width, height };
  });
};

/**
 * Export MP4 or WebM.
 *
 * WebCodecs where the browser has it: every frame is encoded with its exact
 * timestamp, so the file is precisely Duration long however slowly the
 * frames render, and a background tab only makes it slower, not wrong.
 * MediaRecorder is the fallback, and it timestamps frames by the wall
 * clock -- see `recordVideo` for how that is kept honest.
 */
export const exportVideo = async (options: ExportOptions): Promise<ExportResult> => {
  const { chain, data } = options;
  const inputs = gatherInputs(chain, data, true);
  const fps = frameRate(data);
  const totalFrames = frameCount(data, fps);
  const container = data.format === 'webm' ? 'webm' : 'mp4';

  return withSession(options, inputs, async (session) => {
    const encoded = await encodeVideo(session, options, container, fps, totalFrames);
    if (encoded) return encoded;
    return recordVideo(session, options, container, fps, totalFrames);
  });
};

const videoBitrate = (data: RenderNodeData): number => Math.max(500_000, Math.round(25_000_000 * data.quality)); // up to 25 Mbps

/** WebCodecs + mediabunny. Null if the browser can encode none of the codecs. */
const encodeVideo = async (
  session: ExportSession,
  options: ExportOptions,
  container: 'mp4' | 'webm',
  fps: number,
  totalFrames: number,
): Promise<ExportResult | null> => {
  if (typeof VideoEncoder === 'undefined') return null;
  // The muxer is most of the export code by weight and only a video render
  // needs it, so it loads on first use rather than with the editor.
  const { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, WebMOutputFormat, getFirstEncodableVideoCodec } =
    await import('mediabunny');
  const { data, signal, onProgress } = options;
  const { width, height } = session;
  const quality = new Quality({ bitrate: videoBitrate(data) });

  // Asked-for container first; if it has no encodable codec here (MP4 on a
  // browser without H.264/HEVC/AV1 encoding), the other one.
  const attempts: ('mp4' | 'webm')[] = container === 'mp4' ? ['mp4', 'webm'] : ['webm', 'mp4'];
  for (const kind of attempts) {
    const format = kind === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
    const codec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), { width, height, quality });
    if (!codec) continue;

    await session.warmUp(data.time, fps);

    const output = new Output({ format, target: new BufferTarget() });
    const source = new CanvasSource(session.canvas, { codec, quality });
    output.addVideoTrack(source, { frameRate: fps });
    try {
      await output.start();
      for (let f = 0; f < totalFrames; f++) {
        await session.render(data.time + f / fps, 1 / fps);
        await source.add(f / fps, 1 / fps);
        progress(onProgress, f + 1, totalFrames);
        await yieldToEventLoop();
        throwIfAborted(signal);
      }
      await output.finalize();
    } catch (error) {
      if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {});
      throw error;
    }

    const buffer = output.target.buffer;
    if (!buffer) throw new Error('Video encoding produced no data');
    return { blob: new Blob([buffer], { type: format.mimeType }), extension: kind, width, height };
  }
  return null;
};

/**
 * MediaRecorder fallback.
 *
 * The recorder stamps each frame with the wall-clock moment it arrives, so
 * frames have to arrive in real time. The stream is `captureStream(0)` --
 * no frame is taken until `requestFrame` says so, so nothing is captured
 * twice or half-drawn -- and the recorder is paused while each frame
 * renders: paused time is cut from the recording, so a frame that takes
 * half a second to render still occupies exactly 1/fps of the file. The
 * resumed stretch is scheduled against an absolute timeline rather than
 * a fixed sleep, so timer jitter does not accumulate.
 */
const recordVideo = async (
  session: ExportSession,
  options: ExportOptions,
  container: 'mp4' | 'webm',
  fps: number,
  totalFrames: number,
): Promise<ExportResult> => {
  const { data, signal, onProgress } = options;
  const supported = getSupportedVideoMimeType(container);
  if (!supported || typeof session.canvas.captureStream !== 'function') {
    throw new Error('Video export is not supported in this browser');
  }

  await session.warmUp(data.time, fps);

  const stream = session.canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
  const stopTracks = () => {
    for (const t of stream.getTracks()) t.stop();
  };
  if (!track?.requestFrame) {
    stopTracks();
    throw new Error('Video export is not supported in this browser');
  }

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: supported.mimeType,
      videoBitsPerSecond: videoBitrate(data),
    });
  } catch (error) {
    stopTracks();
    throw error;
  }

  const chunks: Blob[] = [];
  let recorderError: Error | null = null;
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.onerror = (event) => {
    const detail = (event as Event & { error?: unknown }).error;
    recorderError = new Error('Video recording failed' + (detail instanceof Error ? ': ' + detail.message : ''));
  };

  const frameMs = 1000 / fps;
  try {
    recorder.start();
    let recorded = 0; // ms of recording timeline so far
    let resumedAt = 0;
    for (let f = 0; f < totalFrames; f++) {
      recorder.pause();
      await session.render(data.time + f / fps, 1 / fps);
      if (recorderError) throw recorderError;
      recorder.resume();
      resumedAt = performance.now();
      track.requestFrame();
      // Hold this frame for its share of the timeline, measured from when
      // the recording resumed.
      await sleep((f + 1) * frameMs - recorded - (performance.now() - resumedAt), signal);
      recorded += performance.now() - resumedAt;
      progress(onProgress, f + 1, totalFrames);
      throwIfAborted(signal);
    }
    if (recorderError) throw recorderError;
  } finally {
    // Recorder first, so the last frame is flushed before its track ends.
    if (recorder.state !== 'inactive') recorder.stop();
    stopTracks();
  }

  await stopped;
  if (recorderError) throw recorderError;
  return {
    blob: new Blob(chunks, { type: supported.mimeType }),
    extension: supported.extension,
    width: session.width,
    height: session.height,
  };
};
