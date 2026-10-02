/**
 * Off-screen render targets for running the graph.
 *
 * A pass cannot read and write the same texture, so every draw writes into a
 * target nobody is reading. In a straight chain two targets alternating
 * would do; a graph with branches needs as many as there are pictures alive
 * at once -- the base waiting at a Blend while its layer is still being
 * worked on -- which is what the pool is for.
 */

/**
 * Storage for a target. Almost everything is `rgba8`; `rgba16f` is for
 * state that is faded a little every frame and read back the next one;
 * `rgba32f` is for numbers an effect builds up between its own sub-passes
 * (a running sum along a row), where half float runs out of digits. Full
 * float is not filterable everywhere, so it is sampled nearest -- read it
 * with `texelFetch`, a texel at a time.
 */
export type TargetFormat = 'rgba8' | 'rgba16f' | 'rgba32f';

export type RenderTarget = {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
  format: TargetFormat;
};

const floatSupport = new WeakMap<WebGL2RenderingContext, boolean>();
const fullFloatSupport = new WeakMap<WebGL2RenderingContext, boolean>();

/**
 * Whether this context can really draw into `format`. Asked with a real
 * framebuffer because a driver advertising EXT_color_buffer_float is not
 * quite the same as one honouring it.
 */
const canRenderTo = (gl: WebGL2RenderingContext, format: 'rgba16f' | 'rgba32f'): boolean => {
  if (!gl.getExtension('EXT_color_buffer_float')) return false;
  let supported = false;
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (texture && framebuffer) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (format === 'rgba32f') {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    supported = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  gl.deleteFramebuffer(framebuffer);
  gl.deleteTexture(texture);
  return supported;
};

/**
 * The format decaying state should live in on this context.
 *
 * Feedback -- a trail, an echo, a particle's afterglow -- is last frame
 * times a factor just under one. In eight bits that product rounds back to
 * the same value once it gets down to a few steps above zero, so the fade
 * stalls and leaves a faint permanent ghost. Half floats keep going all the
 * way to black. Rendering to them needs EXT_color_buffer_float, so this is
 * asked once per context, and verified with a real framebuffer because a
 * driver advertising the extension is not quite the same as one honouring
 * it.
 */
export const feedbackFormat = (gl: WebGL2RenderingContext): TargetFormat => {
  let supported = floatSupport.get(gl);
  if (supported === undefined) {
    supported = canRenderTo(gl, 'rgba16f');
    floatSupport.set(gl, supported);
  }
  return supported ? 'rgba16f' : 'rgba8';
};

/**
 * What an effect that asks for `scratch: 'float'` keeps its intermediate
 * numbers in: full float if it can, else the best this context has.
 */
export const scratchFormat = (gl: WebGL2RenderingContext): TargetFormat => {
  let supported = fullFloatSupport.get(gl);
  if (supported === undefined) {
    supported = canRenderTo(gl, 'rgba32f');
    fullFloatSupport.set(gl, supported);
  }
  return supported ? 'rgba32f' : feedbackFormat(gl);
};

export const createTarget = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  format: TargetFormat = 'rgba8',
): RenderTarget => {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Could not create target texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (format === 'rgba32f') {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
  } else if (format === 'rgba16f') {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  // Full float without OES_texture_float_linear is incomplete under LINEAR,
  // and an incomplete texture reads as black.
  const filter = format === 'rgba32f' ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  // Effects that sample off their own edges should smear the border pixel
  // rather than wrap round to the far side of the image.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) throw new Error('Could not create framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { framebuffer, texture, width, height, format };
};

export const deleteTarget = (gl: WebGL2RenderingContext, target: RenderTarget): void => {
  gl.deleteFramebuffer(target.framebuffer);
  gl.deleteTexture(target.texture);
};

/**
 * Working-resolution targets, handed out and taken back as the frame runs.
 *
 * The pipeline acquires a target for each draw and releases it once the
 * last pass that reads it has run, so the pool only ever grows to the most
 * pictures that were alive at the same moment -- two for a plain chain,
 * three inside a multi-pass effect, a few more for a graph with branches.
 * Targets are kept across frames and reallocated only when the working
 * resolution changes. Each format has its own free list, so asking for a
 * half-float target never hands back an eight-bit one.
 */
export class TargetPool {
  private gl: WebGL2RenderingContext;
  private all: RenderTarget[] = [];
  /** Sets, so releasing twice cannot hand one target to two owners. */
  private free: Record<TargetFormat, Set<RenderTarget>> = {
    rgba8: new Set(),
    rgba16f: new Set(),
    rgba32f: new Set(),
  };
  private width = 0;
  private height = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  resize(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    this.dispose();
    this.width = width;
    this.height = height;
  }

  acquire(format: TargetFormat = 'rgba8'): RenderTarget {
    if (this.width === 0) throw new Error('TargetPool used before resize()');
    const free = this.free[format];
    for (const target of free) {
      free.delete(target);
      return target;
    }
    const target = createTarget(this.gl, this.width, this.height, format);
    this.all.push(target);
    return target;
  }

  release(target: RenderTarget): void {
    this.free[target.format].add(target);
  }

  /** Everything back in the pool, at the end of a frame. */
  releaseAll(): void {
    for (const target of this.all) this.free[target.format].add(target);
  }

  dispose(): void {
    for (const target of this.all) deleteTarget(this.gl, target);
    this.all = [];
    for (const free of Object.values(this.free)) free.clear();
    this.width = 0;
    this.height = 0;
  }
}
