import type { ParamValue } from './effects';
import { createProgramWithShaders, drawQuad, uniform, VERTEX_SOURCE, type UniformCache } from './gl';
import { createTarget, deleteTarget, feedbackFormat, type RenderTarget } from './targets';
import { DRIVER_GRID_SIZE, MAX_PARTICLES, PARTICLE_SIM_SIZE, ParticleSimulation } from './particleStore';

export const SIM_POINT_VERT = `#version 300 es
precision highp float;

uniform sampler2D u_particles;
uniform ivec2 u_simSize;
uniform float u_size;
uniform vec2 u_resolution;
uniform sampler2D u_src;

out vec2 v_pos;
out vec4 v_srcCol;

void main() {
  int x = gl_VertexID % u_simSize.x;
  int y = gl_VertexID / u_simSize.x;
  vec4 p = texelFetch(u_particles, ivec2(x, y), 0);
  vec2 pos = p.xy;
  float birthDelay = p.w;
  v_pos = pos;
  v_srcCol = texture(u_src, vec2(clamp(pos.x, 0.0, 1.0), 1.0 - clamp(pos.y, 0.0, 1.0)));

  if (birthDelay > 0.0 || pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) {
    gl_Position = vec4(-10.0, -10.0, 0.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  // Snap to integer pixels on display target for crisp 1px point render
  vec2 px = floor(pos * u_resolution) + 0.5;
  vec2 clipPos = (px / u_resolution) * 2.0 - 1.0;

  gl_Position = vec4(clipPos.x, 1.0 - (px.y / u_resolution.y) * 2.0, 0.0, 1.0);
  gl_PointSize = max(u_size, 1.0);
}
`;

export const SIM_POINT_FRAG = `#version 300 es
precision highp float;

uniform vec3 u_color;
uniform float u_brightness;
uniform int u_mode;
uniform int u_shape;

in vec2 v_pos;
in vec4 v_srcCol;
out vec4 fragColor;

void main() {
  if (u_shape == 1) {
    // Circle dot phosphor
    vec2 coord = gl_PointCoord - vec2(0.5);
    if (dot(coord, coord) > 0.25) discard;
  }

  vec3 col = u_color;
  if (u_mode == 1) {
    // Source tinted
    col = mix(u_color, v_srcCol.rgb, 0.85);
  } else if (u_mode == 2) {
    // Inverted ink: dark pixel to multiply with white paper
    fragColor = vec4(vec3(0.04), 1.0);
    return;
  }

  fragColor = vec4(col * u_brightness, 1.0);
}
`;

/*
 * Fade towards the backdrop -- black for phosphor, cream for ink.
 *
 * The clamp keeps additive points from banking brightness above white the
 * way an eight-bit buffer never could, so a trail lasts as long in half
 * float as it always did. `u_floor` is for the eight-bit fallback: there,
 * `prev * fade` rounds back to `prev` a few steps above the backdrop and
 * the fade stalls, so every frame also takes a little over half a step off.
 */
export const SIM_DECAY_FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_decay;
uniform float u_fade;
uniform float u_floor;
uniform vec3 u_backdrop;

void main() {
  vec3 prev = clamp(texture(u_decay, v_uv).rgb, 0.0, 1.0);
  vec3 d = prev - u_backdrop;
  d = sign(d) * max(abs(d) * u_fade - u_floor, 0.0);
  fragColor = vec4(u_backdrop + d, 1.0);
}
`;

export const SIM_COMPOSITE_FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_decay;
uniform sampler2D u_src;
uniform sampler2D u_orig;
uniform int u_mode;
uniform float u_mix;

void main() {
  vec4 particles = clamp(texture(u_decay, v_uv), 0.0, 1.0);
  vec4 src = texture(u_src, v_uv);
  vec4 orig = texture(u_orig, v_uv);

  vec4 finalCol;
  if (u_mode == 0) {
    // Phosphor screen: Black backdrop with glowing phosphor traces
    finalCol = vec4(particles.rgb, 1.0);
  } else if (u_mode == 1) {
    // Source tinted screen: Dark source backdrop with glowing phosphor traces
    finalCol = vec4(src.rgb * 0.15 + particles.rgb, 1.0);
  } else if (u_mode == 2) {
    // Inverted Ink: Cream paper backdrop with dark ink points
    finalCol = vec4(particles.rgb, 1.0);
  } else if (u_mode == 3) {
    // Additive overlay on source image
    finalCol = vec4(src.rgb + particles.rgb, 1.0);
  } else {
    // Screen overlay
    vec3 screen = 1.0 - (1.0 - src.rgb) * (1.0 - particles.rgb);
    finalCol = vec4(screen, 1.0);
  }

  fragColor = mix(orig, finalCol, u_mix);
}
`;

/*
 * The input shrunk to the driver grid, for reading back to the CPU. Four
 * bilinear taps a quarter-cell apart average most of what each cell covers,
 * so fine texture in a large frame does not alias into the driver.
 */
export const SIM_DRIVER_FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_src;
uniform vec2 u_cell;

void main() {
  vec2 q = u_cell * 0.25;
  fragColor = 0.25 * (
    texture(u_src, v_uv + vec2(-q.x, -q.y)) +
    texture(u_src, v_uv + vec2( q.x, -q.y)) +
    texture(u_src, v_uv + vec2(-q.x,  q.y)) +
    texture(u_src, v_uv + vec2( q.x,  q.y)));
}
`;

/** Every particle program, as [vertex, fragment], for the static shader checks. */
export const PARTICLE_PROGRAMS: Record<'point' | 'decay' | 'composite' | 'driver', [string, string]> = {
  point: [SIM_POINT_VERT, SIM_POINT_FRAG],
  decay: [VERTEX_SOURCE, SIM_DECAY_FRAG],
  composite: [VERTEX_SOURCE, SIM_COMPOSITE_FRAG],
  driver: [VERTEX_SOURCE, SIM_DRIVER_FRAG],
};

const PAPER: [number, number, number] = [0.96, 0.95, 0.93];
const BLACK: [number, number, number] = [0, 0, 0];

type CompiledPass = {
  program: WebGLProgram;
  uniforms: UniformCache;
};

type NodeSimState = {
  sim: ParticleSimulation;
  stateTex: WebGLTexture;
  /** `sim.version` last uploaded to `stateTex`. */
  uploadedVersion: number;
  decay: [RenderTarget, RenderTarget];
  /** Which of `decay` holds the last frame drawn. */
  current: 0 | 1;
  /** The fade the last frame was drawn with, for redrawing it in place. */
  lastFade: number;
  /** The decay buffers hold nothing worth keeping (new, resized, reset). */
  stale: boolean;
};

export type ParticleRenderRequest = {
  nodeId: string;
  seed: number;
  input: WebGLTexture;
  width: number;
  height: number;
  params: Record<string, ParamValue>;
  /** Clock time of the frame; the simulation is advanced to it. */
  time: number;
  /** Working pixels per source pixel -- `u_pixel_scale` -- for sizing points. */
  pixelScale: number;
  target: RenderTarget;
};

/**
 * Draws particleFlow nodes: a CPU simulation per node, rendered as points
 * into a pair of decaying buffers.
 *
 * Each engine -- one per Pipeline -- owns its simulations and advances them
 * to the time each frame asks for. They are deterministic in that time,
 * which is what lets an export step its own copy frame by frame, and two
 * viewers showing the same moment agree without sharing anything.
 */
export class ParticleEngine {
  private gl: WebGL2RenderingContext;
  private pointPass: CompiledPass;
  private decayPass: CompiledPass;
  private compositePass: CompiledPass;
  private driverPass: CompiledPass;
  private nodes = new Map<string, NodeSimState>();
  private dummyVao: WebGLVertexArrayObject | null = null;
  private format: RenderTarget['format'];
  private driverTarget: RenderTarget | null = null;
  private driverPixels = new Uint8Array(DRIVER_GRID_SIZE * DRIVER_GRID_SIZE * 4);

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const compile = ([vertex, fragment]: [string, string]): CompiledPass => ({
      program: createProgramWithShaders(gl, vertex, fragment),
      uniforms: new Map(),
    });
    this.pointPass = compile(PARTICLE_PROGRAMS.point);
    this.decayPass = compile(PARTICLE_PROGRAMS.decay);
    this.compositePass = compile(PARTICLE_PROGRAMS.composite);
    this.driverPass = compile(PARTICLE_PROGRAMS.driver);
    this.format = feedbackFormat(gl);
    this.dummyVao = gl.createVertexArray();
  }

  private createDecay(width: number, height: number): [RenderTarget, RenderTarget] {
    return [createTarget(this.gl, width, height, this.format), createTarget(this.gl, width, height, this.format)];
  }

  private disposeState(state: NodeSimState): void {
    this.gl.deleteTexture(state.stateTex);
    deleteTarget(this.gl, state.decay[0]);
    deleteTarget(this.gl, state.decay[1]);
  }

  private getNodeState(nodeId: string, seed: number, width: number, height: number): NodeSimState {
    const gl = this.gl;
    let state = this.nodes.get(nodeId);

    // A different seed is a different simulation, not a tweak to this one.
    if (state && state.sim.seed !== seed) {
      this.disposeState(state);
      this.nodes.delete(nodeId);
      state = undefined;
    }

    if (!state) {
      const tex = gl.createTexture();
      if (!tex) throw new Error('Could not create particle state texture');
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, PARTICLE_SIM_SIZE, PARTICLE_SIM_SIZE, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      state = {
        sim: new ParticleSimulation(seed),
        stateTex: tex,
        uploadedVersion: -1,
        decay: this.createDecay(width, height),
        current: 0,
        lastFade: 0,
        stale: true,
      };
      this.nodes.set(nodeId, state);
      return state;
    }

    if (state.decay[0].width !== width || state.decay[0].height !== height) {
      deleteTarget(gl, state.decay[0]);
      deleteTarget(gl, state.decay[1]);
      state.decay = this.createDecay(width, height);
      state.stale = true;
    }

    return state;
  }

  /** Shrink the input to the driver grid and read it back for the CPU. */
  private readDriver(input: WebGLTexture, sim: ParticleSimulation): void {
    const gl = this.gl;
    const n = DRIVER_GRID_SIZE;
    if (!this.driverTarget) this.driverTarget = createTarget(gl, n, n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.driverTarget.framebuffer);
    gl.viewport(0, 0, n, n);
    const { program, uniforms } = this.driverPass;
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.uniform1i(uniform(gl, program, uniforms, 'u_src'), 0);
    gl.uniform2f(uniform(gl, program, uniforms, 'u_cell'), 1 / n, 1 / n);
    drawQuad(gl);
    gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, this.driverPixels);
    sim.driverGrid.update(this.driverPixels, sim.params.driver);
  }

  public render(request: ParticleRenderRequest): void {
    const gl = this.gl;
    const { nodeId, seed, input, width, height, params, time, pixelScale, target } = request;
    const quantity = Math.max(10, Math.min(MAX_PARTICLES, Math.round((params.quantity as number) ?? 20000)));
    const size = (params.size as number) ?? 1.0;
    const shape = (params.shape as number) ?? 0;
    const color = (params.color as [number, number, number]) ?? [1, 1, 1];
    const brightness = (params.brightness as number) ?? 1.5;
    const trail = (params.trail as number) ?? 0.25;
    const mode = (params.mode as number) ?? 0;
    const mixVal = (params.mix as number) ?? 1.0;

    const state = this.getNodeState(nodeId, seed, width, height);
    const { sim } = state;
    sim.setParams(params);

    // 1. Simulate up to this frame's time. The driver is read from the
    // input -- whatever it is: image, video, generator, another effect --
    // only when the particles are actually about to move.
    const frameTime = Math.max(0, time);
    if (sim.time === null || Math.abs(frameTime - sim.time) > 1e-9) this.readDriver(input, sim);
    const { advanced, restarted } = sim.advanceTo(frameTime);
    if (restarted) state.stale = true;

    // Paused, nothing moved: the upload would be the same 1MB as last time.
    if (state.uploadedVersion !== sim.version) {
      gl.bindTexture(gl.TEXTURE_2D, state.stateTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PARTICLE_SIM_SIZE, PARTICLE_SIM_SIZE, gl.RGBA, gl.FLOAT, sim.data);
      state.uploadedVersion = sim.version;
    }

    /*
     * 2. Decay / accumulation.
     *
     * A frame that moved on fades the last one into the other buffer and
     * draws the particles over it. A redraw at the same moment -- paused,
     * with a knob being turned -- must not do that, or every redraw adds
     * another layer of points and the picture brightens on its own. It
     * repeats the last frame's draw instead: same source buffer, same fade,
     * into the same destination, with whatever the knobs now say.
     */
    let fade: number;
    if (advanced > 0 || state.stale) {
      fade = state.stale ? 0 : Math.pow(0.1, advanced / Math.max(trail * 1.5, 0.02));
      state.current = state.current === 0 ? 1 : 0;
      state.lastFade = fade;
      state.stale = false;
    } else {
      fade = state.lastFade;
    }
    if (trail <= 0.001) fade = 0;
    const decayWrite = state.decay[state.current];
    const decayRead = state.decay[state.current === 0 ? 1 : 0];
    const backdrop = mode === 2 ? PAPER : BLACK;

    gl.bindFramebuffer(gl.FRAMEBUFFER, decayWrite.framebuffer);
    gl.viewport(0, 0, width, height);

    if (fade > 0) {
      const { program, uniforms } = this.decayPass;
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, decayRead.texture);
      gl.uniform1i(uniform(gl, program, uniforms, 'u_decay'), 0);
      gl.uniform1f(uniform(gl, program, uniforms, 'u_fade'), fade);
      gl.uniform1f(uniform(gl, program, uniforms, 'u_floor'), this.format === 'rgba8' ? 0.6 / 255 : 0);
      gl.uniform3f(uniform(gl, program, uniforms, 'u_backdrop'), backdrop[0], backdrop[1], backdrop[2]);
      drawQuad(gl);
    } else {
      gl.clearColor(backdrop[0], backdrop[1], backdrop[2], 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // 3. Draw particle points
    gl.enable(gl.BLEND);
    if (mode === 2) {
      gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    } else {
      gl.blendFunc(gl.ONE, gl.ONE);
    }

    const point = this.pointPass;
    gl.useProgram(point.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.stateTex);
    gl.uniform1i(uniform(gl, point.program, point.uniforms, 'u_particles'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.uniform1i(uniform(gl, point.program, point.uniforms, 'u_src'), 1);

    gl.uniform2i(uniform(gl, point.program, point.uniforms, 'u_simSize'), PARTICLE_SIM_SIZE, PARTICLE_SIM_SIZE);
    gl.uniform2f(uniform(gl, point.program, point.uniforms, 'u_resolution'), width, height);
    // Size is in source pixels, like every other pixel-sized param, so a
    // preview at reduced size and a full-size export draw the same dots.
    gl.uniform1f(uniform(gl, point.program, point.uniforms, 'u_size'), size * pixelScale);
    gl.uniform1i(uniform(gl, point.program, point.uniforms, 'u_shape'), shape);
    gl.uniform3f(uniform(gl, point.program, point.uniforms, 'u_color'), color[0], color[1], color[2]);
    gl.uniform1f(uniform(gl, point.program, point.uniforms, 'u_brightness'), brightness);
    gl.uniform1i(uniform(gl, point.program, point.uniforms, 'u_mode'), mode);

    if (this.dummyVao) gl.bindVertexArray(this.dummyVao);
    gl.drawArrays(gl.POINTS, 0, quantity);
    if (this.dummyVao) gl.bindVertexArray(null);

    gl.disable(gl.BLEND);

    // 4. Composite to the node's output
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, width, height);
    const composite = this.compositePass;
    gl.useProgram(composite.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, decayWrite.texture);
    gl.uniform1i(uniform(gl, composite.program, composite.uniforms, 'u_decay'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.uniform1i(uniform(gl, composite.program, composite.uniforms, 'u_src'), 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.uniform1i(uniform(gl, composite.program, composite.uniforms, 'u_orig'), 2);

    gl.uniform1i(uniform(gl, composite.program, composite.uniforms, 'u_mode'), mode);
    gl.uniform1f(uniform(gl, composite.program, composite.uniforms, 'u_mix'), mixVal);

    drawQuad(gl);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Start every simulation and trail over, as a reset of the clock should. */
  public reset(): void {
    for (const state of this.nodes.values()) {
      state.sim.restart();
      state.stale = true;
    }
  }

  public prune(liveNodes: Set<string>): void {
    for (const [nodeId, state] of this.nodes) {
      if (liveNodes.has(nodeId)) continue;
      this.disposeState(state);
      this.nodes.delete(nodeId);
    }
  }

  public dispose(): void {
    const gl = this.gl;
    for (const state of this.nodes.values()) this.disposeState(state);
    this.nodes.clear();
    if (this.driverTarget) {
      deleteTarget(gl, this.driverTarget);
      this.driverTarget = null;
    }

    if (this.dummyVao) {
      gl.deleteVertexArray(this.dummyVao);
      this.dummyVao = null;
    }

    gl.deleteProgram(this.pointPass.program);
    gl.deleteProgram(this.decayPass.program);
    gl.deleteProgram(this.compositePass.program);
    gl.deleteProgram(this.driverPass.program);
  }
}
