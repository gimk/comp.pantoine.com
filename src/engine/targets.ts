/**
 * Off-screen render targets for running the graph.
 *
 * A pass cannot read and write the same texture, so every draw writes into a
 * target nobody is reading. In a straight chain two targets alternating
 * would do; a graph with branches needs as many as there are pictures alive
 * at once -- the base waiting at a Blend while its layer is still being
 * worked on -- which is what the pool is for.
 */

export type RenderTarget = {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
};

export const createTarget = (gl: WebGL2RenderingContext, width: number, height: number): RenderTarget => {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Could not create target texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // Effects that sample off their own edges should smear the border pixel
  // rather than wrap round to the far side of the image.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) throw new Error('Could not create framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { framebuffer, texture, width, height };
};

/**
 * Working-resolution targets, handed out and taken back as the frame runs.
 *
 * The pipeline acquires a target for each draw and releases it once the
 * last pass that reads it has run, so the pool only ever grows to the most
 * pictures that were alive at the same moment -- two for a plain chain,
 * three inside a multi-pass effect, a few more for a graph with branches.
 * Targets are kept across frames and reallocated only when the working
 * resolution changes.
 */
export class TargetPool {
  private gl: WebGL2RenderingContext;
  private all: RenderTarget[] = [];
  /** A set, so releasing twice cannot hand one target to two owners. */
  private free = new Set<RenderTarget>();
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

  acquire(): RenderTarget {
    if (this.width === 0) throw new Error('TargetPool used before resize()');
    for (const target of this.free) {
      this.free.delete(target);
      return target;
    }
    const target = createTarget(this.gl, this.width, this.height);
    this.all.push(target);
    return target;
  }

  release(target: RenderTarget): void {
    this.free.add(target);
  }

  /** Everything back in the pool, at the end of a frame. */
  releaseAll(): void {
    for (const target of this.all) this.free.add(target);
  }

  dispose(): void {
    for (const target of this.all) {
      this.gl.deleteFramebuffer(target.framebuffer);
      this.gl.deleteTexture(target.texture);
    }
    this.all = [];
    this.free.clear();
    this.width = 0;
    this.height = 0;
  }
}
