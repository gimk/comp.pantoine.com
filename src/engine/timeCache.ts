/**
 * Past frames of a node's input, kept on the GPU so a shader can read any
 * of them -- what TouchDesigner's Cache TOP feeds a Time Machine.
 *
 * Frames are recorded on a fixed grid of the clock, `fps` slots a second,
 * rather than once per rendered frame. A preview drawing at 60 fps and an
 * export at 24 then hold the same moments, so a delay of half a second is
 * half a second in both. A frame that lands on the slot already written
 * overwrites it with the newer picture; one that skips slots fills each of
 * them with itself, so nothing reads a stale layer.
 *
 * Time going backwards -- a reset, a seek, the clock wrapping -- starts the
 * cache again, filled throughout with the current frame: a still image put
 * through a Time Machine is still that image, not a fade up from black.
 *
 * Storage is one RGBA8 2D array texture per node, its layers the ring. It
 * is the one thing in the engine whose size is frames times a picture, so
 * it is held to a budget: past it, the cache gets smaller pictures rather
 * than fewer frames, since the frame count is what sets how far back the
 * node can reach.
 */

/** GPU memory one node's cache may take, in bytes. */
export const CACHE_BUDGET = 256 * 1024 * 1024;

export type TimeCacheConfig = {
  /** Layers in the ring: the reach is (frames - 1) / fps seconds. */
  frames: number;
  /** Slots per second of clock time. */
  fps: number;
  /** Cache pixels per working pixel, before the budget has its say. */
  scale: number;
};

/** The cache's picture size and layer count for a working frame. */
export const cacheShape = (
  config: TimeCacheConfig,
  workWidth: number,
  workHeight: number,
  maxLayers: number,
  budget: number = CACHE_BUDGET,
): { width: number; height: number; layers: number } => {
  const layers = Math.max(2, Math.min(Math.round(config.frames), maxLayers));
  let scale = Math.min(1, Math.max(config.scale, 0.01));
  const bytes = workWidth * workHeight * scale * scale * 4 * layers;
  if (bytes > budget) scale *= Math.sqrt(budget / bytes);
  return {
    width: Math.max(1, Math.floor(workWidth * scale)),
    height: Math.max(1, Math.floor(workHeight * scale)),
    layers,
  };
};

/**
 * Which slots a frame at `slot` has to write, given the last slot written
 * (null for an empty or reset cache). Never more than the ring holds: a
 * jump longer than that overwrites every layer once.
 */
export const slotsToWrite = (last: number | null, slot: number, layers: number): number[] => {
  if (last === null || slot < last) {
    // Fill the whole ring, oldest first, so the newest lands on `slot`.
    return Array.from({ length: layers }, (_, k) => slot - layers + 1 + k);
  }
  const from = Math.max(last + 1, slot - layers + 1);
  if (from > slot) return [slot];
  return Array.from({ length: slot - from + 1 }, (_, k) => from + k);
};

/** Ring layer of an absolute slot, for negative slots too. */
export const layerOf = (slot: number, layers: number): number => ((slot % layers) + layers) % layers;

type Cache = {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
  layers: number;
  fps: number;
  /** Last absolute slot written; null until the first frame. */
  last: number | null;
};

/** What a Time Machine shader is handed to read the cache with. */
export type CacheBinding = {
  texture: WebGLTexture;
  /** Clock time in slots: where a delay of zero lands. */
  now: number;
  /** The newest slot written, which holds the current frame. */
  head: number;
  layers: number;
  fps: number;
};

export class TimeCacheStore {
  private gl: WebGL2RenderingContext;
  private caches = new Map<string, Cache>();
  private maxLayers: number;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
  }

  /**
   * Record this frame's input for `nodeId` and say how to read the cache.
   * `draw` renders the input into whatever framebuffer is bound, at the
   * viewport it is given -- the pipeline's plain copy.
   */
  record(
    nodeId: string,
    config: TimeCacheConfig,
    workWidth: number,
    workHeight: number,
    time: number,
    draw: () => void,
  ): CacheBinding {
    const gl = this.gl;
    const shape = cacheShape(config, workWidth, workHeight, this.maxLayers);
    const fps = Math.max(config.fps, 0.001);
    let cache = this.caches.get(nodeId);
    if (
      !cache ||
      cache.width !== shape.width ||
      cache.height !== shape.height ||
      cache.layers !== shape.layers ||
      cache.fps !== fps
    ) {
      if (cache) this.delete(cache);
      cache = this.create(shape.width, shape.height, shape.layers, fps);
      this.caches.set(nodeId, cache);
    }

    const now = Math.max(0, time) * fps;
    const slot = Math.floor(now);
    gl.bindFramebuffer(gl.FRAMEBUFFER, cache.framebuffer);
    gl.viewport(0, 0, cache.width, cache.height);
    for (const write of slotsToWrite(cache.last, slot, cache.layers)) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, cache.texture, 0, layerOf(write, cache.layers));
      draw();
    }
    gl.viewport(0, 0, workWidth, workHeight);
    cache.last = slot;

    return { texture: cache.texture, now, head: slot, layers: cache.layers, fps };
  }

  /** Drop the caches of nodes that were not drawn this frame. */
  prune(live: Set<string>): void {
    for (const [nodeId, cache] of this.caches) {
      if (live.has(nodeId)) continue;
      this.delete(cache);
      this.caches.delete(nodeId);
    }
  }

  /** Forget every recorded frame; the next one fills the ring again. */
  reset(): void {
    for (const cache of this.caches.values()) cache.last = null;
  }

  dispose(): void {
    for (const cache of this.caches.values()) this.delete(cache);
    this.caches.clear();
  }

  private create(width: number, height: number, layers: number, fps: number): Cache {
    const gl = this.gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('Could not create time cache');
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, width, height, layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    return { texture, framebuffer, width, height, layers, fps, last: null };
  }

  private delete(cache: Cache): void {
    this.gl.deleteFramebuffer(cache.framebuffer);
    this.gl.deleteTexture(cache.texture);
  }
}
