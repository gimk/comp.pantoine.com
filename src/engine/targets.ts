/**
 * Off-screen render targets for chaining effects.
 *
 * Effects read the previous stage and write the next, so a pass cannot read
 * and write the same texture. Two targets are enough for any chain length:
 * each pass reads one and writes the other, and they swap round.
 */

export type RenderTarget = {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
};

const createTarget = (gl: WebGL2RenderingContext, width: number, height: number): RenderTarget => {
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
 * A pair of targets sized to the working resolution, reallocated only when
 * that resolution actually changes.
 */
export class PingPong {
  private gl: WebGL2RenderingContext;
  private targets: [RenderTarget, RenderTarget] | null = null;
  private width = 0;
  private height = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  resize(width: number, height: number): void {
    if (this.targets && this.width === width && this.height === height) return;
    this.dispose();
    this.targets = [createTarget(this.gl, width, height), createTarget(this.gl, width, height)];
    this.width = width;
    this.height = height;
  }

  /** Target `index` of the pair, alternating as the chain advances. */
  at(index: number): RenderTarget {
    if (!this.targets) throw new Error('PingPong used before resize()');
    return this.targets[index % 2];
  }

  dispose(): void {
    if (!this.targets) return;
    for (const target of this.targets) {
      this.gl.deleteFramebuffer(target.framebuffer);
      this.gl.deleteTexture(target.texture);
    }
    this.targets = null;
    this.width = 0;
    this.height = 0;
  }
}
