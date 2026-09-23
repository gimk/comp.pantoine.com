import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { ExportFormat, RenderNodeData, ResolvedChain } from '../state/graph';
import { Pipeline, type RenderPlan } from './pipeline';
import { createContext } from './gl';
import { getImage, type LoadedImage } from './imageStore';

export type ExportProgress = {
  currentFrame: number;
  totalFrames: number;
  percent: number;
};

export type ProgressCallback = (progress: ExportProgress) => void;

/** Collect all loaded images required by the plan. */
export const imagesForPlan = (plan: RenderPlan): Map<string, LoadedImage> | null => {
  const images = new Map<string, LoadedImage>();
  for (const step of plan.steps) {
    if (step.kind !== 'image') continue;
    const img = getImage(step.nodeId);
    if (!img) return null;
    images.set(step.nodeId, img);
  }
  return images;
};

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

/** Export a single still frame as PNG or JPG. */
export const exportStill = async (options: {
  chain: ResolvedChain;
  data: RenderNodeData;
}): Promise<{ blob: Blob; extension: string }> => {
  const { chain, data } = options;
  const primary = getImage(chain.sourceNodeId);
  if (!primary) throw new Error('Source image not loaded');

  const images = imagesForPlan(chain.plan);
  if (!images) throw new Error('Missing input images in chain');

  const width = Math.max(1, Math.round(primary.width * data.scale));
  const height = Math.max(1, Math.round(primary.height * data.scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const gl = createContext(canvas);
  if (!gl) throw new Error('WebGL2 context could not be created');
  const pipeline = new Pipeline(gl);

  try {
    pipeline.resetFeedback();
    pipeline.render({
      plan: chain.plan,
      images,
      primaryNodeId: chain.sourceNodeId,
      time: data.time,
      delta: 0.016,
      frame: 0,
      canvasWidth: width,
      canvasHeight: height,
      maxWorkingSize: Math.max(4096, Math.max(width, height)),
    });

    const isJpg = data.format === 'jpg';
    const mimeType = isJpg ? 'image/jpeg' : 'image/png';
    const extension = isJpg ? 'jpg' : 'png';

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to create image blob'));
        },
        mimeType,
        isJpg ? data.quality : undefined,
      );
    });

    return { blob, extension };
  } finally {
    pipeline.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
};

/** Export an animated GIF using gifenc. */
export const exportGif = async (options: {
  chain: ResolvedChain;
  data: RenderNodeData;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; extension: string }> => {
  const { chain, data, onProgress, signal } = options;
  const primary = getImage(chain.sourceNodeId);
  if (!primary) throw new Error('Source image not loaded');

  const images = imagesForPlan(chain.plan);
  if (!images) throw new Error('Missing input images in chain');

  const width = Math.max(1, Math.round(primary.width * data.scale));
  const height = Math.max(1, Math.round(primary.height * data.scale));
  const totalFrames = Math.max(1, Math.round(data.duration * data.fps));
  const dt = 1 / data.fps;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const gl = createContext(canvas);
  if (!gl) throw new Error('WebGL2 context could not be created');
  const pipeline = new Pipeline(gl);

  try {
    pipeline.resetFeedback();
    const gif = GIFEncoder();
    const maxColors = Math.max(16, Math.min(256, Math.round(data.quality * 240 + 16)));
    const rgba = new Uint8Array(width * height * 4);
    const flipped = new Uint8Array(width * height * 4);
    const rowBytes = width * 4;
    const delay = Math.max(10, Math.round(1000 / data.fps));

    for (let f = 0; f < totalFrames; f++) {
      if (signal?.aborted) throw new Error('Export cancelled');

      const currentTime = data.time + f * dt;
      pipeline.render({
        plan: chain.plan,
        images,
        primaryNodeId: chain.sourceNodeId,
        time: currentTime,
        delta: dt,
        frame: f,
        canvasWidth: width,
        canvasHeight: height,
        maxWorkingSize: Math.max(4096, Math.max(width, height)),
      });

      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);

      // Flip vertically: WebGL is bottom-to-top, GIF expects top-to-bottom
      for (let y = 0; y < height; y++) {
        const srcOffset = y * rowBytes;
        const dstOffset = (height - 1 - y) * rowBytes;
        flipped.set(rgba.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
      }

      const palette = quantize(flipped, maxColors, { format: 'rgb565' });
      const index = applyPalette(flipped, palette, 'rgb565');

      gif.writeFrame(index, width, height, {
        palette,
        delay,
        repeat: 0,
      });

      onProgress?.({
        currentFrame: f + 1,
        totalFrames,
        percent: Math.round(((f + 1) / totalFrames) * 100),
      });

      // Yield briefly to keep UI responsive
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    gif.finish();
    const bytes = gif.bytes();
    const blob = new Blob([bytes], { type: 'image/gif' });
    return { blob, extension: 'gif' };
  } finally {
    pipeline.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
};

/** Export a video using MediaRecorder and canvas stream. */
export const exportVideo = async (options: {
  chain: ResolvedChain;
  data: RenderNodeData;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; extension: string }> => {
  const { chain, data, onProgress, signal } = options;
  const primary = getImage(chain.sourceNodeId);
  if (!primary) throw new Error('Source image not loaded');

  const images = imagesForPlan(chain.plan);
  if (!images) throw new Error('Missing input images in chain');

  const supported = getSupportedVideoMimeType(data.format === 'mp4' ? 'mp4' : 'webm');
  if (!supported) {
    throw new Error('Video recording is not supported in this browser');
  }

  const width = Math.max(1, Math.round(primary.width * data.scale));
  const height = Math.max(1, Math.round(primary.height * data.scale));
  const totalFrames = Math.max(1, Math.round(data.duration * data.fps));
  const dt = 1 / data.fps;
  const frameIntervalMs = 1000 / data.fps;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const gl = createContext(canvas);
  if (!gl) throw new Error('WebGL2 context could not be created');
  const pipeline = new Pipeline(gl);

  try {
    pipeline.resetFeedback();

    const stream = canvas.captureStream(data.fps);
    const videoTrack = stream.getVideoTracks()[0] as
      | (MediaStreamTrack & { requestFrame?: () => void })
      | undefined;

    const recorder = new MediaRecorder(stream, {
      mimeType: supported.mimeType,
      videoBitsPerSecond: Math.round(25000000 * data.quality), // up to 25 Mbps
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    const recordPromise = new Promise<{ blob: Blob; extension: string }>((resolve, reject) => {
      recorder.onstop = () => {
        const finalBlob = new Blob(chunks, { type: supported.mimeType });
        resolve({ blob: finalBlob, extension: supported.extension });
      };
      recorder.onerror = (err) => reject(err);
    });

    recorder.start();

    for (let f = 0; f < totalFrames; f++) {
      if (signal?.aborted) {
        recorder.stop();
        throw new Error('Export cancelled');
      }

      const currentTime = data.time + f * dt;
      pipeline.render({
        plan: chain.plan,
        images,
        primaryNodeId: chain.sourceNodeId,
        time: currentTime,
        delta: dt,
        frame: f,
        canvasWidth: width,
        canvasHeight: height,
        maxWorkingSize: Math.max(4096, Math.max(width, height)),
      });

      if (videoTrack?.requestFrame) {
        videoTrack.requestFrame();
      }

      onProgress?.({
        currentFrame: f + 1,
        totalFrames,
        percent: Math.round(((f + 1) / totalFrames) * 100),
      });

      // Pace recording so MediaRecorder samples at steady intervals
      await new Promise((resolve) => setTimeout(resolve, frameIntervalMs));
    }

    recorder.stop();
    return await recordPromise;
  } finally {
    pipeline.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
};
