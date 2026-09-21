import type { EffectDef } from './effects';
import { buildFragmentSource, prelude } from './effects';
import { createProgram, drawQuad, uniform, type UniformCache } from './gl';
import { PingPong } from './targets';
import type { LoadedImage } from './imageStore';

/** One effect node, resolved into everything a draw call needs. */
export type Pass = {
  def: EffectDef;
  params: Record<string, number>;
};

export type RenderRequest = {
  nodeId: string;
  image: LoadedImage;
  passes: Pass[];
  /** Seconds since the renderer started, fed to animated effects. */
  time: number;
  canvasWidth: number;
  canvasHeight: number;
};

/**
 * The final blit. Effects run at the image's own resolution; this is the one
 * pass that cares about the canvas, so aspect fitting lives here and every
 * effect can assume a 1:1 pixel grid.
 */
const PRESENT_FRAGMENT = prelude + `
void main() {
  fragColor = texture(u_src, v_uv);
}
`;

type CompiledProgram = {
  program: WebGLProgram;
  uniforms: UniformCache;
};

export class Pipeline {
  private gl: WebGL2RenderingContext;
  private pingPong: PingPong;
  private programs = new Map<string, CompiledProgram>();
  private present: CompiledProgram;
  private sourceTexture: WebGLTexture | null = null;
  private sourceKey = '';

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.pingPong = new PingPong(gl);
    this.present = this.compile('__present__', PRESENT_FRAGMENT);
  }

  private compile(key: string, source: string): CompiledProgram {
    const existing = this.programs.get(key);
    if (existing) return existing;
    const compiled: CompiledProgram = {
      program: createProgram(this.gl, source),
      uniforms: new Map(),
    };
    this.programs.set(key, compiled);
    return compiled;
  }

  private programFor(def: EffectDef): CompiledProgram {
    return this.compile(def.id, buildFragmentSource(def));
  }

  /**
   * Upload the bitmap once and hold it until the node's image is replaced.
   *
   * No flip here: `decodeImage` already produced the bitmap in GL
   * orientation, and `UNPACK_FLIP_Y_WEBGL` does not apply to ImageBitmap
   * sources anyway.
   */
  private sourceTextureFor(nodeId: string, image: LoadedImage): WebGLTexture {
    const gl = this.gl;
    const key = nodeId + ':' + image.version;
    if (this.sourceTexture && this.sourceKey === key) return this.sourceTexture;

    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not create source texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image.bitmap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.sourceTexture = texture;
    this.sourceKey = key;
    return texture;
  }

  private bindSource(
    compiled: CompiledProgram,
    texture: WebGLTexture,
    width: number,
    height: number,
    time: number,
  ): void {
    const gl = this.gl;
    gl.useProgram(compiled.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniform(gl, compiled.program, compiled.uniforms, 'u_src'), 0);
    gl.uniform2f(uniform(gl, compiled.program, compiled.uniforms, 'u_resolution'), width, height);
    gl.uniform1f(uniform(gl, compiled.program, compiled.uniforms, 'u_time'), time);
  }

  render(request: RenderRequest): void {
    const gl = this.gl;
    const { image, passes, time, canvasWidth, canvasHeight } = request;
    if (canvasWidth === 0 || canvasHeight === 0) return;

    const source = this.sourceTextureFor(request.nodeId, image);

    // Run the chain at the image's own resolution so no effect is working
    // against a preview-sized approximation of the picture.
    let result = source;
    if (passes.length > 0) {
      this.pingPong.resize(image.width, image.height);
      gl.viewport(0, 0, image.width, image.height);
      for (let i = 0; i < passes.length; i += 1) {
        const pass = passes[i];
        const target = this.pingPong.at(i);
        const compiled = this.programFor(pass.def);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        this.bindSource(compiled, result, image.width, image.height, time);
        for (const spec of pass.def.params) {
          const value = pass.params[spec.key] ?? spec.default;
          const location = uniform(gl, compiled.program, compiled.uniforms, 'u_' + spec.key);
          gl.uniform1f(location, value);
        }
        drawQuad(gl);
        result = target.texture;
      }
    }

    // Present: clear the whole canvas, then draw the result into the
    // letterboxed rect that preserves the image's aspect ratio.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const scale = Math.min(canvasWidth / image.width, canvasHeight / image.height);
    const fitWidth = Math.round(image.width * scale);
    const fitHeight = Math.round(image.height * scale);
    gl.viewport(
      Math.round((canvasWidth - fitWidth) / 2),
      Math.round((canvasHeight - fitHeight) / 2),
      fitWidth,
      fitHeight,
    );
    this.bindSource(this.present, result, image.width, image.height, time);
    drawQuad(gl);
  }

  /** Clear the canvas to transparent, for when nothing is wired up. */
  clear(canvasWidth: number, canvasHeight: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  dispose(): void {
    const gl = this.gl;
    this.pingPong.dispose();
    for (const compiled of this.programs.values()) gl.deleteProgram(compiled.program);
    this.programs.clear();
    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    this.sourceTexture = null;
    this.sourceKey = '';
  }
}
