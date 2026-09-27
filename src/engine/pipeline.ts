import type { EffectDef, ParamSpec, ParamValue, Rgb, Vec2 } from './effects';
import { FIRST_INPUT_UNIT, buildFragmentSource, inputsOf, isPhasedParam, paramsOf, passesOf, prelude } from './effects';
import { createProgram, drawQuad, uniform, type UniformCache } from './gl';
import { TargetPool, createTarget, deleteTarget, feedbackFormat, type RenderTarget, type TargetFormat } from './targets';
import { clearShaderError, reportShaderError } from './shaderErrors';
import { modulatedValue, signalIsMoving, signalKey, type Signal } from './modulators';
import { PhaseIntegrator, constantPhase } from './phase';
import type { LoadedImage } from './imageStore';
import type { LoadedVideo } from './videoStore';
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
  | { kind: 'video'; nodeId: string }
  | {
      kind: 'generator';
      nodeId: string;
      pass: Pass;
      width: number;
      height: number;
    }
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
  /** Every video the plan reads, by node id. */
  videos?: Map<string, LoadedVideo>;
  /** Every generator the plan reads, by node id. */
  generators?: Map<string, { width: number; height: number }>;
  /**
   * The image, video, or generator at the head of the main input path. Its size sets the working
   * resolution and the shape of the frame; any other source is fitted to it.
   */
  primaryNodeId: string;
  /**
   * Seconds since the renderer started, wrapped. Fed to animated effects,
   * and the only thing phases and particle simulations depend on -- so the
   * same time renders the same frame in any viewer or export.
   */
  time: number;
  /** Seconds since the previous frame, clamped. */
  delta: number;
  frame: number;
  canvasWidth: number;
  canvasHeight: number;
  /** Longest working-buffer edge; the chain runs scaled down past this. */
  maxWorkingSize: number;
  /**
   * Working pixels per source pixel, exactly -- overrides `maxWorkingSize`,
   * and may be above 1. Export uses it to run the chain at the output size
   * itself rather than rendering large and shrinking.
   */
  workingScale?: number;
  /** Fit mode: 'fit' / 'contain' letterboxes (default), 'fill' / 'cover' fills the canvas cropping overflow. */
  fitMode?: 'fill' | 'fit' | 'cover' | 'contain';
};

/**
 * The final blit. Effects run at the working resolution; this is the one
 * pass that cares about the canvas, so aspect fitting lives here and every
 * effect can assume a 1:1 pixel grid.
 */
export const PRESENT_FRAGMENT = prelude + `
void main() {
  fragColor = texture(u_src, v_uv);
}
`;

/**
 * Bring a second image into the frame: scaled to cover it, centred, and
 * cropped rather than stretched. `u_cover` is how much of the source each
 * axis shows, 1 on the axis that fits exactly.
 */
export const IMPORT_FRAGMENT = prelude + `
uniform vec2 u_cover;
void main() {
  fragColor = texture(u_src, (v_uv - 0.5) * u_cover + 0.5);
}
`;

/**
 * Store a feedback node's frame for next time. History is half float where
 * the GPU allows, so a fade can reach black instead of stalling a few
 * eight-bit steps above it -- but clamped to the range an eight-bit buffer
 * held, so an effect that leant on that clamp to stay bounded still does.
 */
export const HISTORY_FRAGMENT = prelude + `
void main() {
  fragColor = clamp(texture(u_src, v_uv), 0.0, 1.0);
}
`;

type CompiledProgram = {
  program: WebGLProgram;
  uniforms: UniformCache;
  source?: string;
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
type VideoSourceTexture = {
  texture: WebGLTexture;
  key: string;
  width: number;
  height: number;
  /** `currentTime` of the frame last uploaded; NaN until a real frame is in. */
  lastTime: number;
};

export class Pipeline {
  private gl: WebGL2RenderingContext;
  private pool: TargetPool;
  private programs = new Map<string, CompiledProgram>();
  private present: CompiledProgram;
  private importer: CompiledProgram;
  private historyCopy: CompiledProgram;
  private particleEngine: ParticleEngine;
  /** What feedback state is stored in on this GPU: half float if it can. */
  private feedbackFormat: TargetFormat;
  /** What an unwired extra input samples: one transparent black texel. */
  private blank: WebGLTexture;
  /** One uploaded texture per image node the graph reads. */
  private sources = new Map<string, SourceTexture>();
  /** One uploaded texture per video node the graph reads. */
  private videoSources = new Map<string, VideoSourceTexture>();
  /** Working pixels per source pixel for the frame being drawn: `u_pixel_scale`. */
  private pixelScale = 1;

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
   * Phase per node and speed-like param (speed/rate/roll), as a function of
   * time -- see phase.ts. Keyed `nodeId:paramKey`.
   */
  private phases = new PhaseIntegrator();

  private historyFor(nodeId: string, width: number, height: number): RenderTarget {
    let target = this.history.get(nodeId);
    if (!target) {
      // Fresh texture storage is zero-filled, so a trail's first frame
      // reads black rather than whatever was in that memory.
      target = createTarget(this.gl, width, height, this.feedbackFormat);
      this.history.set(nodeId, target);
    }
    return target;
  }

  private disposeHistory(): void {
    for (const target of this.history.values()) deleteTarget(this.gl, target);
    this.history.clear();
  }

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.pool = new TargetPool(gl);
    this.present = this.compile('__present__', PRESENT_FRAGMENT);
    this.importer = this.compile('__import__', IMPORT_FRAGMENT);
    this.historyCopy = this.compile('__history__', HISTORY_FRAGMENT);
    this.particleEngine = new ParticleEngine(gl);
    this.feedbackFormat = feedbackFormat(gl);

    const blank = gl.createTexture();
    if (!blank) throw new Error('Could not create blank texture');
    gl.bindTexture(gl.TEXTURE_2D, blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.blank = blank;
  }

  private compile(key: string, source: string): CompiledProgram {
    const existing = this.programs.get(key);
    if (existing && existing.source === source) return existing;
    if (existing) {
      this.gl.deleteProgram(existing.program);
      this.programs.delete(key);
    }
    const compiled: CompiledProgram = {
      program: createProgram(this.gl, source),
      uniforms: new Map(),
      source,
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
   * recorded against the source that failed rather than retried: compiling
   * a broken shader every frame would turn one bad module into a stall. A
   * different source -- the module edited and hot-reloaded -- gets a fresh
   * attempt, so fixing a shader takes effect without a page reload.
   */
  private programFor(def: EffectDef, passIndex: number): CompiledProgram {
    const key = def.id + '#' + passIndex;
    let source: string;
    try {
      source = buildFragmentSource(def, passIndex);
    } catch (error) {
      // Refused before it got to the GPU (a bad param key). Keyed by the
      // message, since there is no source to key it by.
      return this.fail(key, def, passIndex, '#refused:' + String(error), error);
    }
    if (this.failed.get(key) === source) return this.present;
    try {
      const compiled = this.compile(key, source);
      if (this.failed.delete(key)) clearShaderError(def.id);
      return compiled;
    } catch (error) {
      return this.fail(key, def, passIndex, source, error);
    }
  }

  private fail(key: string, def: EffectDef, passIndex: number, failedOn: string, error: unknown): CompiledProgram {
    if (this.failed.get(key) === failedOn) return this.present;
    const message = error instanceof Error ? error.message : String(error);
    this.failed.set(key, failedOn);
    // Surfaced on the node as well as logged: a module that silently does
    // nothing is harder to diagnose than one that says it is broken.
    reportShaderError(def.id, message);
    console.error('Effect "' + def.id + '" pass ' + passIndex + ' failed to compile:\n' + message);
    return this.present;
  }

  /** Programs that would not compile, by key, with the source that failed. */
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

  /**
   * The video's current frame as a texture, re-uploaded only when the
   * element has moved to a different time.
   *
   * `lastTime` records a frame actually uploaded, never merely the time the
   * texture was created at: a paused video that was not yet decodable when
   * its texture was made would otherwise count as up to date, and show
   * black until something moved its playhead.
   */
  private videoTextureFor(nodeId: string, video: LoadedVideo): WebGLTexture {
    const gl = this.gl;
    const key = String(video.version);
    let existing = this.videoSources.get(nodeId);
    const element = video.element;
    const videoWidth = element.videoWidth || video.width;
    const videoHeight = element.videoHeight || video.height;

    if (!existing || existing.key !== key || existing.width !== videoWidth || existing.height !== videoHeight) {
      if (existing) gl.deleteTexture(existing.texture);
      const texture = gl.createTexture();
      if (!texture) throw new Error('Could not create video texture');
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      let lastTime = Number.NaN;
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      if (element.readyState >= 2) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, element);
        lastTime = element.currentTime;
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, videoWidth, videoHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

      existing = { texture, key, width: videoWidth, height: videoHeight, lastTime };
      this.videoSources.set(nodeId, existing);
    } else if (element.readyState >= 2 && element.currentTime !== existing.lastTime) {
      gl.bindTexture(gl.TEXTURE_2D, existing.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, element);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      existing.lastTime = element.currentTime;
    }
    return existing.texture;
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
    gl.uniform1f(uniform(gl, program, uniforms, 'u_pixel_scale'), this.pixelScale);
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

    this.display = { framebuffer, texture, width, height, format: 'rgba8' };
    return this.display;
  }

  private disposeDisplay(): void {
    if (!this.display) return;
    deleteTarget(this.gl, this.display);
    this.display = null;
  }

  /** Copy a texture into a target, through `program` (unchanged by default). */
  private copy(
    from: WebGLTexture,
    to: RenderTarget,
    width: number,
    height: number,
    request: RenderRequest,
    program: CompiledProgram = this.present,
  ): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.framebuffer);
    this.bindShared(program, from, from, from, width, height, request, 0, 0);
    drawQuad(gl);
  }

  /**
   * The phase uniforms for one node this frame: `u_phase_<key>` for each
   * speed-like param, as a function of the frame's time alone.
   *
   * Unmodulated -- or modulated by something that cannot move -- the rate
   * is constant and the phase is exact. A moving modulator is integrated
   * (see phase.ts); its identity is everything the rate depends on, so a
   * knob turned on the LFO recomputes the track rather than splicing two
   * different histories together.
   */
  private phasesFor(pass: Pass, specs: ParamSpec[], time: number, live: Set<string>): [string, number][] {
    const out: [string, number][] = [];
    for (const spec of specs) {
      if (!isPhasedParam(spec)) continue;
      const key = pass.nodeId + ':' + spec.key;
      live.add(key);
      const base = pass.params[spec.key] ?? spec.default;
      const signal = pass.modulation[spec.key];
      let phase: number;
      if (signal && signalIsMoving(signal)) {
        const identity = JSON.stringify([signalKey(signal), base]);
        phase = this.phases.integrate(key, time, identity, (t) => Number(modulatedValue(spec, base, signal, t)));
      } else {
        const value = signal ? modulatedValue(spec, base, signal, time) : base;
        phase = constantPhase(time, Number(value));
      }
      out.push([spec.key, phase]);
    }
    return out;
  }

  /**
   * Run every sub-pass of one effect node and return the target holding
   * its result, and whether that target is the pool's to take back.
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
  ): { target: RenderTarget; pooled: boolean } {
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

    // Evaluated once per node per frame, so every sub-pass of a multi-pass
    // effect sees the same modulated value.
    const values = specs.map((spec) => {
      const modulation = pass.modulation[spec.key];
      const base = pass.params[spec.key] ?? spec.default;
      return modulation ? modulatedValue(spec, base, modulation, request.time) : base;
    });
    const phases = this.phasesFor(pass, specs, request.time, livePhases);

    if (pass.def.id === 'particleFlow') {
      liveParticleSims.add(pass.nodeId);
      const resolvedParams: Record<string, ParamValue> = {};
      specs.forEach((spec, k) => {
        resolvedParams[spec.key] = values[k];
      });
      const target = this.pool.acquire();
      this.particleEngine.render({
        nodeId: pass.nodeId,
        seed: pass.seed,
        input,
        width,
        height,
        params: resolvedParams,
        time: request.time,
        pixelScale: this.pixelScale,
        target,
      });
      return { target, pooled: true };
    }

    /*
     * Feedback effects draw into targets of the history's format, so the
     * frame that becomes next frame's `u_prev` never passes through eight
     * bits on the way. The pass whose output is kept is held back from the
     * pool until the end, since later passes may still be drawing.
     */
    const format: TargetFormat = pass.def.feedback ? this.feedbackFormat : 'rgba8';
    const keepIndex = pass.def.feedback
      ? Math.min(bodies.length - 1, Math.max(0, Math.round(pass.def.feedbackPass ?? bodies.length - 1)))
      : -1;
    let kept: RenderTarget | null = null;

    let result = input;
    let current: RenderTarget | null = null;

    for (let i = 0; i < bodies.length; i += 1) {
      const target = this.pool.acquire(format);
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
      for (const [phaseKey, phaseValue] of phases) {
        const loc = uniform(gl, compiled.program, compiled.uniforms, 'u_phase_' + phaseKey);
        if (loc !== null) gl.uniform1f(loc, phaseValue);
      }
      drawQuad(gl);

      // The previous sub-pass's output has just been read for the last time.
      if (current && current !== kept) this.pool.release(current);
      current = target;
      result = target.texture;
      if (i === keepIndex) kept = target;
    }

    // Every effect has at least one body, so the loop always ran.
    const last = current!;
    if (!kept) return { target: last, pooled: true };

    const history = this.historyFor(pass.nodeId, width, height);
    this.copy(kept.texture, history, width, height, request, this.historyCopy);
    if (kept === last) {
      // The usual case: the node's output is exactly what was stored, so
      // hand the (clamped) history on downstream and free the scratch.
      // Nothing writes the history again until this node's next frame.
      this.pool.release(last);
      return { target: history, pooled: false };
    }
    this.pool.release(kept);
    return { target: last, pooled: true };
  }

  render(request: RenderRequest): void {
    const gl = this.gl;
    const { plan, images, videos, primaryNodeId, canvasWidth, canvasHeight, maxWorkingSize } = request;
    if (canvasWidth === 0 || canvasHeight === 0) return;

    const primary = images.get(primaryNodeId) ?? videos?.get(primaryNodeId) ?? request.generators?.get(primaryNodeId);
    if (!primary) return;

    /*
     * Working resolution. An atomic chain is many full-screen passes -- a
     * CRT look is eight of them -- so running a 24MP photo through at its
     * native size is what actually stops the frame loop keeping up. Capping
     * the longest edge trades detail nobody can see in the preview for a
     * chain that stays interactive.
     */
    const scale =
      request.workingScale !== undefined && request.workingScale > 0
        ? request.workingScale
        : Math.min(1, maxWorkingSize / Math.max(primary.width, primary.height));
    const workWidth = Math.max(1, Math.round(primary.width * scale));
    const workHeight = Math.max(1, Math.round(primary.height * scale));
    // Measured off the rounded size, so a pixel param lands on the grid
    // the effects actually run on.
    this.pixelScale = workWidth / primary.width;

    // Feedback buffers are tied to the working resolution, so a change of
    // size throws the stored frames away rather than stretching them.
    if (this.historyWidth !== workWidth || this.historyHeight !== workHeight) {
      this.disposeHistory();
      this.historyWidth = workWidth;
      this.historyHeight = workHeight;
    }
    const liveFeedback = new Set<string>();
    const liveSources = new Set<string>();
    const liveVideoSources = new Set<string>();
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

      if (step.kind === 'video') {
        const video = videos?.get(step.nodeId);
        if (!video) return;
        const texture = this.videoTextureFor(step.nodeId, video);
        liveVideoSources.add(step.nodeId);

        const frameRatio = workWidth / workHeight;
        const ratio = video.width / video.height;
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

      if (step.kind === 'generator') {
        const { target, pooled } = this.runEffect(
          step.pass,
          this.blank,
          [],
          workWidth,
          workHeight,
          request,
          liveFeedback,
          livePhases,
          liveParticleSims,
        );
        textures[index] = target.texture;
        owned[index] = pooled ? target : null;
        return;
      }

      const { target, pooled } = this.runEffect(
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
      owned[index] = pooled ? target : null;

      doneReading(step.input);
      for (const extra of step.extras) if (extra !== null) doneReading(extra);
    });

    const result = textures[plan.output];

    // Buffers belonging to nodes that are no longer in the chain.
    for (const [nodeId, target] of this.history) {
      if (liveFeedback.has(nodeId)) continue;
      deleteTarget(gl, target);
      this.history.delete(nodeId);
    }
    for (const [nodeId, source] of this.sources) {
      if (liveSources.has(nodeId)) continue;
      gl.deleteTexture(source.texture);
      this.sources.delete(nodeId);
    }
    for (const [nodeId, source] of this.videoSources) {
      if (liveVideoSources.has(nodeId)) continue;
      gl.deleteTexture(source.texture);
      this.videoSources.delete(nodeId);
    }
    this.phases.prune(livePhases);
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
    this.phases.clear();
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
    this.phases.clear();
    this.particleEngine.dispose();
    for (const compiled of this.programs.values()) gl.deleteProgram(compiled.program);
    this.programs.clear();
    for (const source of this.sources.values()) gl.deleteTexture(source.texture);
    this.sources.clear();
    for (const source of this.videoSources.values()) gl.deleteTexture(source.texture);
    this.videoSources.clear();
    gl.deleteTexture(this.blank);
  }
}
