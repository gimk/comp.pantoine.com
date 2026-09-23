import type { EffectDef, ParamSpec, ParamValue, Rgb, Vec2 } from './effects';
import { buildFragmentSource, paramsOf, passesOf, prelude } from './effects';
import { createProgram, drawQuad, uniform, type UniformCache } from './gl';
import { PingPong, createTarget, type RenderTarget } from './targets';
import { reportShaderError } from './shaderErrors';
import type { LoadedImage } from './imageStore';

/** One effect node, resolved into everything a draw call needs. */
export type Pass = {
  /**
   * Identity, not just definition: per-node state -- the seed today,
   * feedback buffers later -- has to survive from frame to frame.
   */
  nodeId: string;
  seed: number;
  def: EffectDef;
  params: Record<string, ParamValue>;
};

export type RenderRequest = {
  nodeId: string;
  image: LoadedImage;
  passes: Pass[];
  /** Seconds since the renderer started, wrapped. Fed to animated effects. */
  time: number;
  /** Seconds since the previous frame, clamped. */
  delta: number;
  frame: number;
  canvasWidth: number;
  canvasHeight: number;
  /** Longest working-buffer edge; the chain runs scaled down past this. */
  maxWorkingSize: number;
};

/**
 * The final blit. Effects run at the working resolution; this is the one
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

/** Push one param to the GPU as whatever type its kind declared. */
const setParamUniform = (
  gl: WebGL2RenderingContext,
  location: WebGLUniformLocation | null,
  spec: ParamSpec,
  value: ParamValue | undefined,
): void => {
  if (location === null) return;
  const resolved = value ?? spec.default;
  switch (spec.kind) {
    case 'float':
      gl.uniform1f(location, resolved as number);
      break;
    case 'int':
    case 'enum':
      gl.uniform1i(location, Math.round(resolved as number));
      break;
    case 'bool':
      gl.uniform1i(location, resolved ? 1 : 0);
      break;
    case 'color': {
      const c = resolved as Rgb;
      gl.uniform3f(location, c[0], c[1], c[2]);
      break;
    }
    case 'vec2': {
      const v = resolved as Vec2;
      gl.uniform2f(location, v[0], v[1]);
      break;
    }
  }
};

export class Pipeline {
  private gl: WebGL2RenderingContext;
  private pingPong: PingPong;
  private programs = new Map<string, CompiledProgram>();
  private present: CompiledProgram;
  private sourceTexture: WebGLTexture | null = null;
  private sourceKey = '';

  /**
   * One frame of output kept per feedback node.
   *
   * Keyed by node rather than by effect, so two Trails in one chain each
   * decay their own picture. Entries are dropped for nodes that were not in
   * the chain this frame, which is what frees a deleted node's buffer -- and
   * means unplugging a trail and plugging it back in starts it clean, which
   * is the behaviour you want anyway.
   */
  private history = new Map<string, RenderTarget>();
  private historyWidth = 0;
  private historyHeight = 0;

  private historyFor(nodeId: string, width: number, height: number): RenderTarget {
    let target = this.history.get(nodeId);
    if (!target) {
      // Fresh texture storage is zero-filled, so a trail's first frame
      // reads black rather than whatever was in that memory.
      target = createTarget(this.gl, width, height);
      this.history.set(nodeId, target);
    }
    return target;
  }

  private disposeHistory(): void {
    for (const target of this.history.values()) {
      this.gl.deleteFramebuffer(target.framebuffer);
      this.gl.deleteTexture(target.texture);
    }
    this.history.clear();
  }

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

  /**
   * Each sub-pass of a multi-pass effect is its own program.
   *
   * A shader that will not compile falls back to the pass-through, so the
   * stage carries on unchanged instead of the exception unwinding through
   * the frame loop and taking the editor down with it. The failure is
   * recorded rather than retried: recompiling a broken shader every frame
   * would turn one bad module into a stall.
   */
  private programFor(def: EffectDef, passIndex: number): CompiledProgram {
    const key = def.id + '#' + passIndex;
    if (this.failed.has(key)) return this.present;
    try {
      return this.compile(key, buildFragmentSource(def, passIndex));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failed.set(key, message);
      // Surfaced on the node as well as logged: a module that silently does
      // nothing is harder to diagnose than one that says it is broken.
      reportShaderError(def.id, message);
      console.error('Effect "' + def.id + '" pass ' + passIndex + ' failed to compile:\n' + message);
      return this.present;
    }
  }

  /** Programs that would not compile, and why. Reported once each. */
  private failed = new Map<string, string>();

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

  private bindShared(
    compiled: CompiledProgram,
    texture: WebGLTexture,
    origin: WebGLTexture,
    previous: WebGLTexture,
    width: number,
    height: number,
    request: Pick<RenderRequest, 'time' | 'delta' | 'frame'>,
    seed: number,
    passIndex: number,
  ): void {
    const gl = this.gl;
    const { program, uniforms } = compiled;
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniform(gl, program, uniforms, 'u_src'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, origin);
    gl.uniform1i(uniform(gl, program, uniforms, 'u_orig'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, previous);
    gl.uniform1i(uniform(gl, program, uniforms, 'u_prev'), 2);
    // Put the active unit back. It is global state that outlives the frame,
    // and anything else calling bindTexture assumes it is looking at unit 0.
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(uniform(gl, program, uniforms, 'u_resolution'), width, height);
    gl.uniform1f(uniform(gl, program, uniforms, 'u_time'), request.time);
    gl.uniform1f(uniform(gl, program, uniforms, 'u_delta'), request.delta);
    gl.uniform1i(uniform(gl, program, uniforms, 'u_frame'), request.frame);
    gl.uniform1f(uniform(gl, program, uniforms, 'u_seed'), seed);
    gl.uniform1i(uniform(gl, program, uniforms, 'u_pass'), passIndex);
  }

  render(request: RenderRequest): void {
    const gl = this.gl;
    const { image, passes, canvasWidth, canvasHeight, maxWorkingSize } = request;
    if (canvasWidth === 0 || canvasHeight === 0) return;

    const source = this.sourceTextureFor(request.nodeId, image);

    /*
     * Working resolution. An atomic chain is many full-screen passes -- a
     * CRT look is eight of them -- so running a 24MP photo through at its
     * native size is what actually stops the frame loop keeping up. Capping
     * the longest edge trades detail nobody can see in the preview for a
     * chain that stays interactive.
     */
    const scale = Math.min(1, maxWorkingSize / Math.max(image.width, image.height));
    const workWidth = Math.max(1, Math.round(image.width * scale));
    const workHeight = Math.max(1, Math.round(image.height * scale));

    let result = source;
    const totalPasses = passes.reduce((sum, pass) => sum + passesOf(pass.def).length, 0);

    // Feedback buffers are tied to the working resolution, so a change of
    // size throws the stored frames away rather than stretching them.
    if (this.historyWidth !== workWidth || this.historyHeight !== workHeight) {
      this.disposeHistory();
      this.historyWidth = workWidth;
      this.historyHeight = workHeight;
    }
    const liveFeedback = new Set<string>();

    if (totalPasses > 0) {
      this.pingPong.resize(workWidth, workHeight);
      gl.viewport(0, 0, workWidth, workHeight);

      // One ping-pong slot per sub-pass, so a multi-pass effect alternates
      // targets internally exactly as neighbouring effects do.
      let slot = 0;
      for (const pass of passes) {
        const specs = paramsOf(pass.def);
        const bodies = passesOf(pass.def);

        /*
         * What this effect was handed, kept available to all of its
         * sub-passes as `u_orig`.
         *
         * A single-pass effect can just read the texture it is sampling. A
         * multi-pass one cannot: by its second sub-pass the ping-pong has
         * already reused that buffer, so the input is copied aside first.
         * That copy is what lets a bloom add its glow back over the picture
         * it came from, and what makes Mix on a multi-pass effect blend
         * against the input rather than against a half-finished stage.
         */
        let origin = result;
        if (bodies.length > 1) {
          const held = this.pingPong.hold();
          gl.bindFramebuffer(gl.FRAMEBUFFER, held.framebuffer);
          this.bindShared(this.present, result, result, result, workWidth, workHeight, request, 0, 0);
          drawQuad(gl);
          origin = held.texture;
        }

        // The stored frame is read, never written, while the effect draws --
        // the pass writes into the ping-pong and only afterwards is the
        // result copied across. Rendering straight into the buffer being
        // sampled is undefined, and this is what avoids it.
        let previous = origin;
        if (pass.def.feedback) {
          previous = this.historyFor(pass.nodeId, workWidth, workHeight).texture;
          liveFeedback.add(pass.nodeId);
        }

        for (let i = 0; i < bodies.length; i += 1) {
          const target = this.pingPong.at(slot);
          const compiled = this.programFor(pass.def, i);
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
          this.bindShared(
            compiled,
            result,
            origin,
            previous,
            workWidth,
            workHeight,
            request,
            pass.seed,
            i,
          );
          for (const spec of specs) {
            const location = uniform(gl, compiled.program, compiled.uniforms, 'u_' + spec.key);
            setParamUniform(gl, location, spec, pass.params[spec.key]);
          }
          drawQuad(gl);
          result = target.texture;
          slot += 1;
        }

        if (pass.def.feedback) {
          const store = this.historyFor(pass.nodeId, workWidth, workHeight);
          gl.bindFramebuffer(gl.FRAMEBUFFER, store.framebuffer);
          this.bindShared(this.present, result, result, result, workWidth, workHeight, request, 0, 0);
          drawQuad(gl);
        }
      }
    }

    // Buffers belonging to nodes that are no longer in the chain.
    for (const [nodeId, target] of this.history) {
      if (liveFeedback.has(nodeId)) continue;
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
      this.history.delete(nodeId);
    }

    // Present: clear the whole canvas, then draw the result into the
    // letterboxed rect that preserves the image's aspect ratio.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const fit = Math.min(canvasWidth / image.width, canvasHeight / image.height);
    const fitWidth = Math.round(image.width * fit);
    const fitHeight = Math.round(image.height * fit);
    gl.viewport(
      Math.round((canvasWidth - fitWidth) / 2),
      Math.round((canvasHeight - fitHeight) / 2),
      fitWidth,
      fitHeight,
    );
    this.bindShared(this.present, result, result, result, workWidth, workHeight, request, 0, 0);
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
    this.disposeHistory();
    for (const compiled of this.programs.values()) gl.deleteProgram(compiled.program);
    this.programs.clear();
    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    this.sourceTexture = null;
    this.sourceKey = '';
  }
}
