import type { EffectDef, ParamSpec, ParamValue, Rgb, Vec2 } from './effects';
import { FIRST_INPUT_UNIT, buildFragmentSource, inputsOf, isPhasedParam, paramsOf, passesOf, prelude } from './effects';
import { createProgram, drawQuad, uniform, type UniformCache } from './gl';
import { TargetPool, createTarget, type RenderTarget } from './targets';
import { reportShaderError } from './shaderErrors';
import { modulatedValue, type Signal } from './modulators';
import type { LoadedImage } from './imageStore';
import { ParticleEngine } from './particleSim';

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
  /** Params with a modulator wired in, by key. Re-evaluated every frame. */
  modulation: Record<string, Signal>;
};

/**
 * One picture the frame produces, in the order they have to be made.
 *
 * Inputs are indices of earlier steps, so running the list front to back
 * never reads something that has not been drawn yet. A node that feeds
 * several others appears once and is read by all of them.
 */
export type Step =
  | { kind: 'image'; nodeId: string }
  | {
      kind: 'effect';
      pass: Pass;
      /** The step feeding `u_src`. */
      input: number;
      /** One per `inputsOf(def)`, in order; null where nothing is wired. */
      extras: (number | null)[];
    };

export type RenderPlan = {
  steps: Step[];
  /** The step whose picture ends up on screen. */
  output: number;
};

export type RenderRequest = {
  plan: RenderPlan;
  /** Every image the plan reads, by node id. */
  images: Map<string, LoadedImage>;
  /**
   * The image at the head of the main input path. Its size sets the working
   * resolution and the shape of the frame; any other image is fitted to it.
   */
  primaryNodeId: string;
  /** Seconds since the renderer started, wrapped. Fed to animated effects. */
  time: number;
  /** Seconds since the previous frame, clamped. */
  delta: number;
  frame: number;
  canvasWidth: number;
  canvasHeight: number;
  /** Longest working-buffer edge; the chain runs scaled down past this. */
  maxWorkingSize: number;
  /** Fit mode: 'fit' / 'contain' letterboxes (default), 'fill' / 'cover' fills the canvas cropping overflow. */
  fitMode?: 'fill' | 'fit' | 'cover' | 'contain';
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

/**
 * Bring a second image into the frame: scaled to cover it, centred, and
 * cropped rather than stretched. `u_cover` is how much of the source each
 * axis shows, 1 on the axis that fits exactly.
 */
const IMPORT_FRAGMENT = prelude + `
uniform vec2 u_cover;
void main() {
  fragColor = texture(u_src, (v_uv - 0.5) * u_cover + 0.5);
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

type SourceTexture = { texture: WebGLTexture; key: string };

export class Pipeline {
  private gl: WebGL2RenderingContext;
  private pool: TargetPool;
  private programs = new Map<string, CompiledProgram>();
  private present: CompiledProgram;
  private importer: CompiledProgram;
  private particleEngine: ParticleEngine;
  /** What an unwired extra input samples: one transparent black texel. */
  private blank: WebGLTexture;
  /** One uploaded texture per image node the graph reads. */
  private sources = new Map<string, SourceTexture>();

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
  /**
   * Accumulated phase per node and parameter key (e.g. speed/rate/roll).
   *
   * Integrated over dt each frame so modulating speed with an LFO speeds up
   * or slows down the movement smoothly, rather than oscillating wildly
   * against absolute elapsed time.
   */
  private nodePhases = new Map<string, Map<string, number>>();

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
    this.pool = new TargetPool(gl);
    this.present = this.compile('__present__', PRESENT_FRAGMENT);
    this.importer = this.compile('__import__', IMPORT_FRAGMENT);
    this.particleEngine = new ParticleEngine(gl);

    const blank = gl.createTexture();
    if (!blank) throw new Error('Could not create blank texture');
    gl.bindTexture(gl.TEXTURE_2D, blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.blank = blank;
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
    const key = String(image.version);
    const existing = this.sources.get(nodeId);
    if (existing && existing.key === key) return existing.texture;

    if (existing) gl.deleteTexture(existing.texture);
    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not create source texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image.bitmap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.sources.set(nodeId, { texture, key });
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

  /**
   * The finished frame again, with a full mip chain, for shrinking it into
   * the viewer. Kept apart from the pool: mip levels on a pool target
   * would be stale the moment an effect drew into it, and an effect
   * sampling at a displaced UV could pick one up.
   */
  private display: RenderTarget | null = null;

  private displayFor(width: number, height: number): RenderTarget {
    const gl = this.gl;
    if (this.display && this.display.width === width && this.display.height === height) return this.display;
    this.disposeDisplay();

    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('Could not create display target');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.display = { framebuffer, texture, width, height };
    return this.display;
  }

  private disposeDisplay(): void {
    if (!this.display) return;
    this.gl.deleteFramebuffer(this.display.framebuffer);
    this.gl.deleteTexture(this.display.texture);
    this.display = null;
  }

  /** Copy a texture into a target, unchanged. */
  private copy(from: WebGLTexture, to: RenderTarget, width: number, height: number, request: RenderRequest): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.framebuffer);
    this.bindShared(this.present, from, from, from, width, height, request, 0, 0);
    drawQuad(gl);
  }

  /**
   * Run every sub-pass of one effect node and return the target holding
   * its result.
   *
   * The node's inputs stay alive in the pool until it has finished, so its
   * own input can be bound as `u_orig` for every sub-pass directly -- by the
   * last pass of a bloom, `u_src` holds nothing but blurred highlights, and
   * the picture they go back onto is still sitting in the buffer it came
   * in. That is also what makes Mix on a multi-pass effect blend against
   * the input rather than against a half-finished stage.
   */
  private runEffect(
    pass: Pass,
    input: WebGLTexture,
    extras: WebGLTexture[],
    width: number,
    height: number,
    request: RenderRequest,
    liveFeedback: Set<string>,
    livePhases: Set<string>,
    liveParticleSims: Set<string>,
  ): RenderTarget {
    const gl = this.gl;
    const specs = paramsOf(pass.def);
    const inputs = inputsOf(pass.def);
    const bodies = passesOf(pass.def);

    // The stored frame is read, never written, while the effect draws --
    // the pass writes into a pool target and only afterwards is the result
    // copied across. Rendering straight into the buffer being sampled is
    // undefined, and this is what avoids it.
    let previous = input;
    if (pass.def.feedback) {
      previous = this.historyFor(pass.nodeId, width, height).texture;
      liveFeedback.add(pass.nodeId);
    }

    livePhases.add(pass.nodeId);
    let phases = this.nodePhases.get(pass.nodeId);
    if (!phases) {
      phases = new Map();
      this.nodePhases.set(pass.nodeId, phases);
    }

    // Evaluated once per node per frame, so every sub-pass of a multi-pass
    // effect sees the same modulated value.
    const values = specs.map((spec) => {
      const modulation = pass.modulation[spec.key];
      const base = pass.params[spec.key];
      const val = modulation ? modulatedValue(spec, base, modulation, request.time) : base;

      if (isPhasedParam(spec) && typeof val === 'number') {
        // Integrate speed/rate over time delta: phase = (phase + dt * val) % 1000.
        // Wrapping periodically keeps highp precision intact.
        let cur = phases!.get(spec.key) ?? 0;
        cur = (cur + request.delta * val) % 1000;
        phases!.set(spec.key, cur);
      }
      return val;
    });

    if (pass.def.id === 'particleFlow') {
      liveParticleSims.add(pass.nodeId);
      const resolvedParams: Record<string, ParamValue> = {};
      specs.forEach((spec, k) => {
        resolvedParams[spec.key] = values[k];
      });
      const target = this.pool.acquire();
      this.particleEngine.render(
        pass.nodeId,
        input,
        input,
        width,
        height,
        resolvedParams,
        request.time,
        request.delta,
        pass.seed,
        target,
      );
      return target;
    }

    let result = input;
    let current: RenderTarget | null = null;

    for (let i = 0; i < bodies.length; i += 1) {
      const target = this.pool.acquire();
      const compiled = this.programFor(pass.def, i);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      this.bindShared(compiled, result, input, previous, width, height, request, pass.seed, i);

      // Extra inputs, from unit 3 up; 0-2 are taken by bindShared.
      inputs.forEach((spec, k) => {
        const unit = FIRST_INPUT_UNIT + k;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, extras[k] ?? this.blank);
        gl.uniform1i(uniform(gl, compiled.program, compiled.uniforms, 'u_' + spec.key), unit);
      });
      gl.activeTexture(gl.TEXTURE0);

      specs.forEach((spec, k) => {
        const location = uniform(gl, compiled.program, compiled.uniforms, 'u_' + spec.key);
        setParamUniform(gl, location, spec, values[k]);
      });
      phases.forEach((phaseVal, phaseKey) => {
        const loc = uniform(gl, compiled.program, compiled.uniforms, 'u_phase_' + phaseKey);
        if (loc !== null) gl.uniform1f(loc, phaseVal);
      });
      drawQuad(gl);

      // The previous sub-pass's output has just been read for the last time.
      if (current) this.pool.release(current);
      current = target;
      result = target.texture;
    }

    if (pass.def.feedback) {
      this.copy(result, this.historyFor(pass.nodeId, width, height), width, height, request);
    }

    // Every effect has at least one body, so the loop always ran.
    return current!;
  }

  render(request: RenderRequest): void {
    const gl = this.gl;
    const { plan, images, primaryNodeId, canvasWidth, canvasHeight, maxWorkingSize } = request;
    if (canvasWidth === 0 || canvasHeight === 0) return;

    const primary = images.get(primaryNodeId);
    if (!primary) return;

    /*
     * Working resolution. An atomic chain is many full-screen passes -- a
     * CRT look is eight of them -- so running a 24MP photo through at its
     * native size is what actually stops the frame loop keeping up. Capping
     * the longest edge trades detail nobody can see in the preview for a
     * chain that stays interactive.
     */
    const scale = Math.min(1, maxWorkingSize / Math.max(primary.width, primary.height));
    const workWidth = Math.max(1, Math.round(primary.width * scale));
    const workHeight = Math.max(1, Math.round(primary.height * scale));

    // Feedback buffers are tied to the working resolution, so a change of
    // size throws the stored frames away rather than stretching them.
    if (this.historyWidth !== workWidth || this.historyHeight !== workHeight) {
      this.disposeHistory();
      this.historyWidth = workWidth;
      this.historyHeight = workHeight;
    }
    const liveFeedback = new Set<string>();
    const liveSources = new Set<string>();
    const livePhases = new Set<string>();
    const liveParticleSims = new Set<string>();

    this.pool.resize(workWidth, workHeight);
    gl.viewport(0, 0, workWidth, workHeight);

    /*
     * How many times each step is still going to be read. A step's target
     * goes back to the pool when this reaches zero, which is what lets a
     * straight chain run in two buffers however long it is. The output
     * counts as a reader, so the picture on screen survives to the blit.
     */
    const readers = new Array<number>(plan.steps.length).fill(0);
    readers[plan.output] += 1;
    for (const step of plan.steps) {
      if (step.kind !== 'effect') continue;
      readers[step.input] += 1;
      for (const extra of step.extras) if (extra !== null) readers[extra] += 1;
    }

    const textures: WebGLTexture[] = [];
    const owned: (RenderTarget | null)[] = [];

    const doneReading = (index: number): void => {
      readers[index] -= 1;
      const target = owned[index];
      if (readers[index] === 0 && target) this.pool.release(target);
    };

    plan.steps.forEach((step, index) => {
      if (step.kind === 'image') {
        const image = images.get(step.nodeId)!;
        const texture = this.sourceTextureFor(step.nodeId, image);
        liveSources.add(step.nodeId);

        // Anything the same shape as the frame can be sampled as it is --
        // the primary always is, by definition. Anything else is fitted
        // first, so a layer of a different shape is cropped, not squashed.
        const frameRatio = workWidth / workHeight;
        const ratio = image.width / image.height;
        if (Math.abs(ratio - frameRatio) < 1e-3) {
          textures[index] = texture;
          owned[index] = null;
          return;
        }
        const target = this.pool.acquire();
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        this.bindShared(this.importer, texture, texture, texture, workWidth, workHeight, request, 0, 0);
        const cover = ratio > frameRatio ? [frameRatio / ratio, 1] : [1, ratio / frameRatio];
        gl.uniform2f(uniform(gl, this.importer.program, this.importer.uniforms, 'u_cover'), cover[0], cover[1]);
        drawQuad(gl);
        textures[index] = target.texture;
        owned[index] = target;
        return;
      }

      const target = this.runEffect(
        step.pass,
        textures[step.input],
        step.extras.map((extra) => (extra === null ? this.blank : textures[extra])),
        workWidth,
        workHeight,
        request,
        liveFeedback,
        livePhases,
        liveParticleSims,
      );
      textures[index] = target.texture;
      owned[index] = target;

      doneReading(step.input);
      for (const extra of step.extras) if (extra !== null) doneReading(extra);
    });

    const result = textures[plan.output];

    // Buffers belonging to nodes that are no longer in the chain.
    for (const [nodeId, target] of this.history) {
      if (liveFeedback.has(nodeId)) continue;
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
      this.history.delete(nodeId);
    }
    for (const [nodeId, source] of this.sources) {
      if (liveSources.has(nodeId)) continue;
      gl.deleteTexture(source.texture);
      this.sources.delete(nodeId);
    }
    for (const nodeId of this.nodePhases.keys()) {
      if (!livePhases.has(nodeId)) {
        this.nodePhases.delete(nodeId);
      }
    }
    this.particleEngine.prune(liveParticleSims);

    const isFill = request.fitMode === 'fill' || request.fitMode === 'cover';
    const fit = isFill
      ? Math.max(canvasWidth / primary.width, canvasHeight / primary.height)
      : Math.min(canvasWidth / primary.width, canvasHeight / primary.height);
    const fitWidth = Math.round(primary.width * fit);
    const fitHeight = Math.round(primary.height * fit);

    /*
     * Shrinking the frame into the viewer, which is the usual case -- a
     * 2048px working frame into a card a few hundred pixels tall.
     *
     * A plain bilinear blit reads four texels per screen pixel and skips
     * the rest, so any pattern finer than the screen's pixels -- scanlines,
     * a shadow mask, grain -- comes out as moiré: bands whose size has
     * nothing to do with the pattern, and which jump about as a knob moves.
     * Going through a mip chain averages everything a screen pixel covers
     * instead, so a pattern too fine to show turns into the even tone it
     * would really average to.
     */
    let shown = result;
    if (fitWidth < workWidth || fitHeight < workHeight) {
      const display = this.displayFor(workWidth, workHeight);
      gl.viewport(0, 0, workWidth, workHeight);
      this.copy(result, display, workWidth, workHeight, request);
      gl.bindTexture(gl.TEXTURE_2D, display.texture);
      gl.generateMipmap(gl.TEXTURE_2D);
      shown = display.texture;
    }

    // Present: clear the whole canvas, then draw the result into the
    // letterboxed rect that preserves the image's aspect ratio.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.viewport(
      Math.round((canvasWidth - fitWidth) / 2),
      Math.round((canvasHeight - fitHeight) / 2),
      fitWidth,
      fitHeight,
    );
    this.bindShared(this.present, shown, shown, shown, workWidth, workHeight, request, 0, 0);
    drawQuad(gl);

    this.pool.releaseAll();
  }

  /**
   * Forget every feedback node's stored frame, so trails and echoes start
   * from nothing -- what a reset of the clock to zero should look like.
   */
  resetFeedback(): void {
    this.disposeHistory();
    this.nodePhases.clear();
    this.particleEngine.reset();
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
    this.pool.dispose();
    this.disposeHistory();
    this.disposeDisplay();
    this.nodePhases.clear();
    this.particleEngine.dispose();
    for (const compiled of this.programs.values()) gl.deleteProgram(compiled.program);
    this.programs.clear();
    for (const source of this.sources.values()) gl.deleteTexture(source.texture);
    this.sources.clear();
    gl.deleteTexture(this.blank);
  }
}
