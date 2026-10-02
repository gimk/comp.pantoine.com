import type { EffectDef, ParamSpec, ParamValue, Rgb, Vec2 } from './effects';
import { FIRST_INPUT_UNIT, buildFragmentSource, fieldSampler, inputsOf, isPhasedParam, paramsOf, passesOf, prelude } from './effects';
import { STDLIB } from './stdlib';
import { createProgram, drawQuad, uniform, type UniformCache } from './gl';
import { TimeCacheStore, type CacheBinding } from './timeCache';
import { planFrames, sameShape, type Frame } from './frames';
import { TargetPool, createTarget, deleteTarget, feedbackFormat, scratchFormat, type RenderTarget, type TargetFormat } from './targets';
import { clearShaderError, reportShaderError } from './shaderErrors';
import {
  evaluateSignal,
  fieldOperatorBody,
  fieldPortUniforms,
  modulatedValue,
  modulatorPortsOf,
  signalIsMoving,
  signalKey,
  type ModulatorDef,
  type Signal,
} from './modulators';
import { setStatistics, summarize } from './statistics';
import { PhaseCarry, PhaseIntegrator, constantPhase } from './phase';
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
      fields: FieldBinding[];
    }
  | {
      kind: 'effect';
      pass: Pass;
      /** The step feeding `u_src`. */
      input: number;
      /** One per `inputsOf(def)`, in order; null where nothing is wired. */
      extras: (number | null)[];
      fields: FieldBinding[];
    }
  | {
      /**
       * A single number wired where a picture goes, as a flat grey -- how
       * Blender converts a float into a colour. Sized like a fresh
       * generator if it ends up setting the frame.
       */
      kind: 'fill';
      nodeId: string;
      signal: Signal;
    }
  | {
      /** A Math or Map Range with a picture on a port: the same maths, per pixel. */
      kind: 'fieldOp';
      nodeId: string;
      def: ModulatorDef;
      /** The node's params, with any it derives from its inputs worked out. */
      params: Record<string, ParamValue>;
      /** What fills each wired port: a picture, or a single number. */
      ports: Record<string, FieldPort>;
    }
  | {
      /** Measure a picture for an Image Statistic node; draws nothing. */
      kind: 'statistic';
      nodeId: string;
      /** The picture measured, or null if nothing that makes one is wired. */
      input: number | null;
    };

/** A param with a picture wired into it: the step whose picture it reads. */
export type FieldBinding = { key: string; step: number };

export type FieldPort = { step: number } | { signal: Signal };


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

/**
 * A single number as a picture: a flat grey of that value, as Blender
 * turns a float into a colour. Written to a half-float target where the
 * GPU allows, so a 200 stays 200 when it reaches a param as a field.
 */
export const FILL_FRAGMENT = prelude + `
uniform float u_value;
void main() {
  fragColor = vec4(vec3(u_value), 1.0);
}
`;

/** The side of the grid a picture is sampled on for Image Statistic. */
const STAT_SIZE = 64;

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

/** The earlier steps whose pictures one step reads. */
const stepReads = (step: Step): number[] => {
  switch (step.kind) {
    case 'effect':
      return [
        step.input,
        ...step.extras.filter((extra): extra is number => extra !== null),
        ...step.fields.map((field) => field.step),
      ];
    case 'generator':
      return step.fields.map((field) => field.step);
    case 'fieldOp':
      return Object.values(step.ports).flatMap((port) => ('step' in port ? [port.step] : []));
    case 'statistic':
      return step.input === null ? [] : [step.input];
    default:
      return [];
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
  private filler: CompiledProgram;
  /** Where a picture is sampled down to be measured for Image Statistic; made on first use. */
  private statTarget: RenderTarget | null = null;
  /** How many textures one draw can sample; the ceiling on extra inputs plus fields. */
  private maxUnits: number;
  private particleEngine: ParticleEngine;
  /** What feedback state is stored in on this GPU: half float if it can. */
  private feedbackFormat: TargetFormat;
  /** What an effect's float scratch passes draw into: full float if it can. */
  private scratchFormat: TargetFormat;
  /** What an unwired extra input samples: one transparent black texel. */
  private blank: WebGLTexture;
  /** One uploaded texture per image node the graph reads. */
  private sources = new Map<string, SourceTexture>();
  /** One uploaded texture per video node the graph reads. */
  private videoSources = new Map<string, VideoSourceTexture>();
  /** The frame of the step being drawn's main input: `u_input_frame` for a Resize/Crop. */
  private inputFrame: Frame = { width: 1, height: 1 };
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
  /**
   * Phase per node and speed-like param (speed/rate/roll), as a function of
   * time -- see phase.ts. Keyed `nodeId:paramKey`.
   */
  private phases = new PhaseIntegrator();
  /** Offsets that keep each phase continuous across a change of rate; see phase.ts. */
  private carries = new PhaseCarry();
  /** Past input frames per Time Machine node; see timeCache.ts. */
  private timeCaches: TimeCacheStore;
  /** Nodes whose time cache was used this frame; the rest are dropped. */
  private liveCaches = new Set<string>();

  private historyFor(nodeId: string, width: number, height: number): RenderTarget {
    let target = this.history.get(nodeId);
    // Tied to its node's working size: a change of size throws the stored
    // frame away rather than stretching it.
    if (target && (target.width !== width || target.height !== height)) {
      deleteTarget(this.gl, target);
      this.history.delete(nodeId);
      target = undefined;
    }
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
    this.filler = this.compile('__fill__', FILL_FRAGMENT);
    this.maxUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number;
    this.particleEngine = new ParticleEngine(gl);
    this.feedbackFormat = feedbackFormat(gl);
    this.scratchFormat = scratchFormat(gl);
    this.timeCaches = new TimeCacheStore(gl);

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
  private programFor(def: EffectDef, passIndex: number, fields: readonly string[] = []): CompiledProgram {
    // A field changes the source, so each set of fielded params is a program of its own.
    const key = def.id + '#' + passIndex + (fields.length > 0 ? '|' + fields.join(',') : '');
    let source: string;
    try {
      source = buildFragmentSource(def, passIndex, fields);
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
   *
   * Either way the result goes through `carries`, so a rate that changes
   * while the clock runs -- a Speed slider being dragged -- picks up from
   * the phase on screen instead of jumping to the new rate times all of
   * elapsed time.
   */
  private phasesFor(pass: Pass, specs: ParamSpec[], time: number, live: Set<string>): [string, number][] {
    const out: [string, number][] = [];
    for (const spec of specs) {
      if (!isPhasedParam(spec)) continue;
      const key = pass.nodeId + ':' + spec.key;
      live.add(key);
      const base = pass.params[spec.key] ?? spec.default;
      const signal = pass.modulation[spec.key];
      let raw: number;
      let identity: string;
      if (signal && signalIsMoving(signal)) {
        identity = JSON.stringify([signalKey(signal), base]);
        raw = this.phases.integrate(key, time, identity, (t) => Number(modulatedValue(spec, base, signal, t)));
      } else {
        const value = Number(signal ? modulatedValue(spec, base, signal, time) : base);
        identity = 'rate:' + value;
        raw = constantPhase(time, value);
      }
      out.push([spec.key, this.carries.carry(key, time, identity, raw)]);
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
    /** Pictures for the params wired to a field, by param key. */
    fields: Map<string, WebGLTexture> = new Map(),
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
    // Every pass but the last, for an effect that hands numbers between its
    // own passes. The last stays in `format`, so downstream sees an
    // ordinary picture.
    const scratch: TargetFormat = pass.def.scratch === 'float' ? this.scratchFormat : format;
    const keepIndex = pass.def.feedback
      ? Math.min(bodies.length - 1, Math.max(0, Math.round(pass.def.feedbackPass ?? bodies.length - 1)))
      : -1;
    let kept: RenderTarget | null = null;

    let result = input;
    let current: RenderTarget | null = null;

    // Fields take the units after the extra inputs, and a time cache the
    // one after those. A module with more fields than the GPU has units
    // for keeps the rest at their values.
    const cacheUnits = pass.def.timeCache ? 1 : 0;
    const fieldUnits = Math.max(0, this.maxUnits - FIRST_INPUT_UNIT - inputs.length - cacheUnits);
    const fielded = specs.filter((spec) => fields.has(spec.key)).slice(0, fieldUnits);
    const fieldKeys = fielded.map((spec) => spec.key);

    // Recorded before the node draws, so the newest slot is this frame.
    let cache: CacheBinding | null = null;
    if (pass.def.timeCache) {
      const resolved: Record<string, ParamValue> = {};
      specs.forEach((spec, k) => {
        resolved[spec.key] = values[k];
      });
      this.liveCaches.add(pass.nodeId);
      cache = this.timeCaches.record(pass.nodeId, pass.def.timeCache(resolved), width, height, request.time, () => {
        this.bindShared(this.present, input, input, input, width, height, request, 0, 0);
        drawQuad(gl);
      });
    }

    for (let i = 0; i < bodies.length; i += 1) {
      const target = this.pool.acquire(i < bodies.length - 1 ? scratch : format);
      const compiled = this.programFor(pass.def, i, fieldKeys);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      this.bindShared(compiled, result, input, previous, width, height, request, pass.seed, i);

      // Extra inputs, from unit 3 up; 0-2 are taken by bindShared.
      inputs.forEach((spec, k) => {
        const unit = FIRST_INPUT_UNIT + k;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, extras[k] ?? this.blank);
        gl.uniform1i(uniform(gl, compiled.program, compiled.uniforms, 'u_' + spec.key), unit);
      });
      fielded.forEach((spec, k) => {
        const unit = FIRST_INPUT_UNIT + inputs.length + k;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, fields.get(spec.key)!);
        gl.uniform1i(uniform(gl, compiled.program, compiled.uniforms, fieldSampler(spec.key)), unit);
      });
      if (cache) {
        const unit = FIRST_INPUT_UNIT + inputs.length + fielded.length;
        const { program, uniforms } = compiled;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, cache.texture);
        gl.uniform1i(uniform(gl, program, uniforms, 'u_cache'), unit);
        gl.uniform1f(uniform(gl, program, uniforms, 'u_cache_now'), cache.now);
        gl.uniform1f(uniform(gl, program, uniforms, 'u_cache_head'), cache.head);
        gl.uniform1f(uniform(gl, program, uniforms, 'u_cache_layers'), cache.layers);
        gl.uniform1f(uniform(gl, program, uniforms, 'u_cache_fps'), cache.fps);
      }
      gl.activeTexture(gl.TEXTURE0);

      specs.forEach((spec, k) => {
        const location = uniform(gl, compiled.program, compiled.uniforms, 'u_' + spec.key);
        setParamUniform(gl, location, spec, values[k]);
      });
      if (pass.def.frame) {
        const loc = uniform(gl, compiled.program, compiled.uniforms, 'u_input_frame');
        gl.uniform2f(loc, this.inputFrame.width, this.inputFrame.height);
      }
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

  /**
   * A Math or Map Range, per pixel. Its program is built from the node's
   * `field` body; each port reads its picture if one is wired, and its
   * single value -- a signal, or what is typed -- if not.
   */
  private runFieldOp(
    step: Extract<Step, { kind: 'fieldOp' }>,
    textures: WebGLTexture[],
    width: number,
    height: number,
    request: RenderRequest,
  ): RenderTarget {
    const gl = this.gl;
    const { def, params, ports } = step;
    const target = this.pool.acquire(this.feedbackFormat);
    const { uniforms: declared, body } = fieldOperatorBody(def);
    const source = `${prelude}${STDLIB}\n${declared}\n\nvoid main() {\n${body}\n}\n`;
    let compiled: CompiledProgram;
    try {
      compiled = this.compile('__field__' + def.id, source);
    } catch (error) {
      console.error('Field "' + def.id + '" failed to compile:\n' + String(error));
      compiled = this.present;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    this.bindShared(compiled, this.blank, this.blank, this.blank, width, height, request, 0, 0);

    const portKeys = new Set(modulatorPortsOf(def));
    let unit = FIRST_INPUT_UNIT;
    for (const spec of def.params) {
      const at = (name: string) => uniform(gl, compiled.program, compiled.uniforms, name);
      if (!portKeys.has(spec.key)) {
        const location = at('u_' + spec.key);
        setParamUniform(gl, location, spec, params[spec.key]);
        continue;
      }
      const names = fieldPortUniforms(spec.key);
      const port = ports[spec.key];
      const picture = port && 'step' in port ? textures[port.step] : undefined;
      if (picture && unit < this.maxUnits) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, picture);
        gl.uniform1i(at(names.sampler), unit);
        gl.uniform1i(at(names.wired), 1);
        unit += 1;
      } else {
        const value =
          port && 'signal' in port
            ? evaluateSignal(port.signal, request.time)
            : typeof params[spec.key] === 'number'
              ? (params[spec.key] as number)
              : spec.kind === 'float' || spec.kind === 'int'
                ? spec.default
                : 0;
        gl.uniform1i(at(names.wired), 0);
        gl.uniform1f(at(names.value), value);
      }
    }
    gl.activeTexture(gl.TEXTURE0);
    drawQuad(gl);
    return target;
  }

  /**
   * Sample a picture on a small grid and read it back, for Image Statistic.
   *
   * A synchronous readback, which stalls until the GPU has drawn the
   * picture -- but over a 64x64 grid, and it is what lets a knob driven by
   * the measurement follow it on the very same frame, in an export as
   * much as in a viewer. Linear filtering averages a little around each
   * grid point, which is what a statistic of a picture means anyway.
   */
  private measure(nodeId: string, picture: WebGLTexture | null, request: RenderRequest): void {
    const gl = this.gl;
    if (!picture) {
      setStatistics(nodeId, [0, 0, 0, 0, 0]);
      return;
    }
    if (!this.statTarget) this.statTarget = createTarget(gl, STAT_SIZE, STAT_SIZE, this.feedbackFormat);
    const target = this.statTarget;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, STAT_SIZE, STAT_SIZE);
    this.bindShared(this.present, picture, picture, picture, STAT_SIZE, STAT_SIZE, request, 0, 0);
    drawQuad(gl);
    if (target.format === 'rgba16f') {
      const pixels = new Float32Array(STAT_SIZE * STAT_SIZE * 4);
      gl.readPixels(0, 0, STAT_SIZE, STAT_SIZE, gl.RGBA, gl.FLOAT, pixels);
      setStatistics(nodeId, summarize(pixels));
    } else {
      const pixels = new Uint8Array(STAT_SIZE * STAT_SIZE * 4);
      gl.readPixels(0, 0, STAT_SIZE, STAT_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      // Alpha is tested for zero only, so it can stay on the 0..255 scale.
      setStatistics(nodeId, summarize(pixels, 255));
    }
  }

  render(request: RenderRequest): void {
    const gl = this.gl;
    const { plan, images, videos, canvasWidth, canvasHeight, maxWorkingSize } = request;
    if (canvasWidth === 0 || canvasHeight === 0) return;

    // Every picture's frame, in source pixels -- see frames.ts. Without a
    // Resize/Crop in the graph they are all the head source's.
    const frames = planFrames(plan, { image: (id) => images.get(id), video: (id) => videos?.get(id) });
    const outputFrame = frames[plan.output];
    if (!outputFrame) return;

    /*
     * Working resolution. An atomic chain is many full-screen passes -- a
     * CRT look is eight of them -- so running a 24MP photo through at its
     * native size is what actually stops the frame loop keeping up. Capping
     * the longest edge trades detail nobody can see in the preview for a
     * chain that stays interactive. Per frame, so a picture resized down
     * runs at its own size rather than its source's.
     */
    const workOf = (frame: Frame): Frame => {
      const scale =
        request.workingScale !== undefined && request.workingScale > 0
          ? request.workingScale
          : Math.min(1, maxWorkingSize / Math.max(frame.width, frame.height));
      return {
        width: Math.max(1, Math.round(frame.width * scale)),
        height: Math.max(1, Math.round(frame.height * scale)),
      };
    };
    /** Draw in `frame` from here on: pool size, viewport, `u_pixel_scale`. */
    const enter = (frame: Frame): Frame => {
      const work = workOf(frame);
      this.pool.use(work.width, work.height);
      gl.viewport(0, 0, work.width, work.height);
      // Measured off the rounded size, so a pixel param lands on the grid
      // the effects actually run on.
      this.pixelScale = work.width / frame.width;
      return work;
    };

    const liveFeedback = new Set<string>();
    this.liveCaches.clear();
    const liveSources = new Set<string>();
    const liveVideoSources = new Set<string>();
    const livePhases = new Set<string>();
    const liveParticleSims = new Set<string>();

    /*
     * How many times each step is still going to be read. A step's target
     * goes back to the pool when this reaches zero, which is what lets a
     * straight chain run in two buffers however long it is. The output
     * counts as a reader, so the picture on screen survives to the blit.
     */
    const readers = new Array<number>(plan.steps.length).fill(0);
    readers[plan.output] += 1;
    for (const step of plan.steps) for (const read of stepReads(step)) readers[read] += 1;

    const textures: WebGLTexture[] = [];
    const owned: (RenderTarget | null)[] = [];

    const doneReading = (index: number): void => {
      readers[index] -= 1;
      const target = owned[index];
      if (readers[index] === 0 && target) this.pool.release(target);
    };

    /** Scale `texture` to cover `work`, centred and cropped rather than stretched. */
    const cover = (texture: WebGLTexture, from: Frame, to: Frame, work: Frame): RenderTarget => {
      const target = this.pool.acquire();
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      this.bindShared(this.importer, texture, texture, texture, work.width, work.height, request, 0, 0);
      const toRatio = to.width / to.height;
      const ratio = from.width / from.height;
      const fit = ratio > toRatio ? [toRatio / ratio, 1] : [1, ratio / toRatio];
      gl.uniform2f(uniform(gl, this.importer.program, this.importer.uniforms, 'u_cover'), fit[0], fit[1]);
      drawQuad(gl);
      return target;
    };

    plan.steps.forEach((step, index) => {
      const frame = frames[index];
      const work = frame ? enter(frame) : null;

      // A picture made for a reader of another shape -- read by two nodes
      // in different frames -- is fitted to this one for this step only.
      const temporary: RenderTarget[] = [];
      const read = (from: number): WebGLTexture => {
        const texture = textures[from];
        const source = frames[from];
        if (!texture) return this.blank;
        if (!frame || !work || !source || sameShape(source, frame)) return texture;
        const target = cover(texture, source, frame, work);
        temporary.push(target);
        return target.texture;
      };

      if (step.kind === 'image' || step.kind === 'video') {
        const media = step.kind === 'image' ? images.get(step.nodeId) : videos?.get(step.nodeId);
        if (!media || !frame || !work) return;
        const texture =
          step.kind === 'image'
            ? this.sourceTextureFor(step.nodeId, media as LoadedImage)
            : this.videoTextureFor(step.nodeId, media as LoadedVideo);
        (step.kind === 'image' ? liveSources : liveVideoSources).add(step.nodeId);

        // Anything the same shape as its frame can be sampled as it is --
        // a source heading the main path always is, by definition. Anything
        // else is fitted first, so a layer of a different shape is cropped,
        // not squashed.
        if (sameShape(media, frame)) {
          textures[index] = texture;
          owned[index] = null;
          return;
        }
        const target = cover(texture, media, frame, work);
        textures[index] = target.texture;
        owned[index] = target;
        return;
      }

      const fieldTextures = (bindings: FieldBinding[]): Map<string, WebGLTexture> =>
        new Map(bindings.map((binding) => [binding.key, read(binding.step)]));

      if (step.kind === 'fill') {
        if (!work) return;
        const target = this.pool.acquire(this.feedbackFormat);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        this.bindShared(this.filler, this.blank, this.blank, this.blank, work.width, work.height, request, 0, 0);
        const value = evaluateSignal(step.signal, request.time);
        gl.uniform1f(uniform(gl, this.filler.program, this.filler.uniforms, 'u_value'), value);
        drawQuad(gl);
        textures[index] = target.texture;
        owned[index] = target;
        return;
      }

      if (step.kind === 'fieldOp') {
        if (!work) return;
        // The ports' pictures, fitted where they need it.
        const local = textures.slice();
        for (const port of Object.values(step.ports)) if ('step' in port) local[port.step] = read(port.step);
        const target = this.runFieldOp(step, local, work.width, work.height, request);
        textures[index] = target.texture;
        owned[index] = target;
      } else if (step.kind === 'statistic') {
        this.measure(step.nodeId, step.input === null ? null : textures[step.input] ?? null, request);
      } else if (step.kind === 'generator') {
        if (!work) return;
        const { target, pooled } = this.runEffect(
          step.pass,
          this.blank,
          [],
          work.width,
          work.height,
          request,
          liveFeedback,
          livePhases,
          liveParticleSims,
          fieldTextures(step.fields),
        );
        textures[index] = target.texture;
        owned[index] = pooled ? target : null;
      } else {
        if (!work) return;
        // A frame-defining effect reads its input raw, whatever its shape:
        // that picture is what it resizes.
        const resizes = !!step.pass.def.frame;
        this.inputFrame = frames[step.input] ?? frame ?? this.inputFrame;
        const { target, pooled } = this.runEffect(
          step.pass,
          resizes ? textures[step.input] ?? this.blank : read(step.input),
          step.extras.map((extra) => (extra === null ? this.blank : read(extra))),
          work.width,
          work.height,
          request,
          liveFeedback,
          livePhases,
          liveParticleSims,
          fieldTextures(step.fields),
        );
        textures[index] = target.texture;
        owned[index] = pooled ? target : null;
      }

      for (const target of temporary) this.pool.release(target);
      for (const reading of stepReads(step)) doneReading(reading);
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
    this.carries.prune(livePhases);
    this.particleEngine.prune(liveParticleSims);
    this.timeCaches.prune(this.liveCaches);

    const isFill = request.fitMode === 'fill' || request.fitMode === 'cover';
    const fit = isFill
      ? Math.max(canvasWidth / outputFrame.width, canvasHeight / outputFrame.height)
      : Math.min(canvasWidth / outputFrame.width, canvasHeight / outputFrame.height);
    const fitWidth = Math.round(outputFrame.width * fit);
    const fitHeight = Math.round(outputFrame.height * fit);
    const { width: workWidth, height: workHeight } = workOf(outputFrame);

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
    this.carries.clear();
    this.particleEngine.reset();
    this.timeCaches.reset();
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
    this.carries.clear();
    this.particleEngine.dispose();
    this.timeCaches.dispose();
    if (this.statTarget) deleteTarget(gl, this.statTarget);
    this.statTarget = null;
    for (const compiled of this.programs.values()) gl.deleteProgram(compiled.program);
    this.programs.clear();
    for (const source of this.sources.values()) gl.deleteTexture(source.texture);
    this.sources.clear();
    for (const source of this.videoSources.values()) gl.deleteTexture(source.texture);
    this.videoSources.clear();
    gl.deleteTexture(this.blank);
  }
}
