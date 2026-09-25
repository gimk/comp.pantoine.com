import type { ParamValue } from './effects';
import { createProgramWithShaders, drawQuad, uniform, VERTEX_SOURCE, type UniformCache } from './gl';
import { createTarget, type RenderTarget } from './targets';

export const PARTICLE_SIM_SIZE = 256;
const MAX_PARTICLES = PARTICLE_SIM_SIZE * PARTICLE_SIM_SIZE; // 65,536

const SIM_UPDATE_FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_particles;
uniform sampler2D u_src;
uniform ivec2 u_simSize;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_delta;
uniform float u_seed;
uniform int u_emitter;
uniform vec2 u_origin;
uniform float u_angle;
uniform float u_spread;
uniform int u_driver;
uniform float u_speed;
uniform float u_slowdown;

vec4 hash42(vec2 p) {
  vec4 p4 = fract(vec4(p.xyxy) * vec4(443.897, 441.423, 437.195, 444.129));
  p4 += dot(p4, p4.wzxy + 19.19);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

float lumaVal(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2 uvCoord = gl_FragCoord.xy / vec2(u_simSize);
  vec4 p = texelFetch(u_particles, coord, 0);

  vec2 pos = p.xy;
  float dirAngle = p.z;
  float speedVar = (p.w > 0.01) ? p.w : 1.0;

  float rad = radians(u_angle);
  vec2 dirVec = vec2(cos(rad), sin(rad));
  if (length(dirVec) < 0.001) dirVec = vec2(0.0, -1.0);

  // If emitter is Edge, ALL particles move in the exact same direction rad
  if (u_emitter == 0) {
    dirAngle = rad;
  }

  // Check if particle has left the frame
  bool outOfBounds = (pos.x < -0.02 || pos.x > 1.02 || pos.y < -0.02 || pos.y > 1.02);

  if (outOfBounds) {
    vec4 rnd = hash42(uvCoord * 231.7 + vec2(u_time * 19.1 + float(coord.x), u_seed * 43.1 + float(coord.y)));
    speedVar = 0.8 + 0.4 * rnd.w;

    vec2 effDir = (u_speed >= 0.0) ? dirVec : -dirVec;

    if (u_emitter == 0) {
      // Edge (Directional Sweep): All particles enter from upstream boundary in exact same direction
      dirAngle = rad;
      vec2 dirPerp = vec2(-effDir.y, effDir.x);

      float absDx = abs(effDir.x);
      float absDy = abs(effDir.y);
      float distToEdge = 1e5;
      if (absDx > 0.0001) distToEdge = min(distToEdge, 0.5 / absDx);
      if (absDy > 0.0001) distToEdge = min(distToEdge, 0.5 / absDy);

      vec2 edgeCenter = vec2(0.5, 0.5) - effDir * distToEdge;
      vec2 spawnPos = edgeCenter + dirPerp * ((rnd.x - 0.5) * 1.4);
      spawnPos = clamp(spawnPos, vec2(0.0), vec2(1.0));
      pos = spawnPos + effDir * 0.005;
    } else if (u_emitter == 1) {
      // Point (Directional Cone)
      pos = u_origin + effDir * 0.005;
      float spreadRad = radians(max(u_spread, 0.0));
      dirAngle = rad + (rnd.x - 0.5) * spreadRad;
    } else if (u_emitter == 2) {
      // Point (Radial 360°)
      pos = u_origin;
      dirAngle = rnd.x * 6.28318530718;
    } else {
      // Fullscreen Drift
      pos = rnd.xy;
      dirAngle = rad;
    }
  } else {
    // Active simulation step
    vec4 srcCol = texture(u_src, clamp(pos, 0.0, 1.0));
    float drv = 0.0;
    if (u_driver == 0) {
      drv = lumaVal(srcCol.rgb);
    } else if (u_driver == 1) {
      drv = 1.0 - lumaVal(srcCol.rgb);
    } else if (u_driver == 2) {
      float mx = max(srcCol.r, max(srcCol.g, srcCol.b));
      float mn = min(srcCol.r, min(srcCol.g, srcCol.b));
      drv = (mx > 0.001) ? (mx - mn) / mx : 0.0;
    } else if (u_driver == 3) {
      vec2 off = 1.5 / u_resolution;
      float lx = lumaVal(texture(u_src, clamp(pos + vec2(off.x, 0.0), 0.0, 1.0)).rgb) - lumaVal(texture(u_src, clamp(pos - vec2(off.x, 0.0), 0.0, 1.0)).rgb);
      float ly = lumaVal(texture(u_src, clamp(pos + vec2(0.0, off.y), 0.0, 1.0)).rgb) - lumaVal(texture(u_src, clamp(pos - vec2(0.0, off.y), 0.0, 1.0)).rgb);
      drv = clamp(length(vec2(lx, ly)) * 6.0, 0.0, 1.0);
    } else if (u_driver == 4) {
      drv = srcCol.r;
    } else if (u_driver == 5) {
      drv = srcCol.g;
    } else if (u_driver == 6) {
      drv = srcCol.b;
    } else if (u_driver == 7) {
      float mx = max(srcCol.r, max(srcCol.g, srcCol.b));
      float mn = min(srcCol.r, min(srcCol.g, srcCol.b));
      float d = mx - mn;
      drv = (d > 0.001) ? fract(((mx == srcCol.r) ? (srcCol.g - srcCol.b) / d : (mx == srcCol.g) ? (srcCol.b - srcCol.r) / d + 2.0 : (srcCol.r - srcCol.g) / d + 4.0) / 6.0) : 0.0;
    }

    vec2 curDir = (u_emitter == 0) ? dirVec : vec2(cos(dirAngle), sin(dirAngle));
    float baseSpeed = u_speed * 0.35 * speedVar;
    float speedFactor = 1.0 / (1.0 + u_slowdown * 4.0 * drv);
    float dt = clamp(u_delta, 0.0005, 0.06);

    pos += curDir * (baseSpeed * speedFactor) * dt;
  }

  fragColor = vec4(pos, dirAngle, speedVar);
}
`;

const SIM_POINT_VERT = `#version 300 es
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
  v_pos = pos;
  v_srcCol = texture(u_src, clamp(pos, 0.0, 1.0));

  if (pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) {
    gl_Position = vec4(-10.0, -10.0, 0.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  // Snap to integer pixels on display target
  vec2 px = floor(pos * u_resolution) + 0.5;
  vec2 clipPos = (px / u_resolution) * 2.0 - 1.0;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  gl_PointSize = max(u_size, 1.0);
}
`;

const SIM_POINT_FRAG = `#version 300 es
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

const SIM_DECAY_FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_decay;
uniform float u_fade;
uniform int u_mode;

void main() {
  vec4 prev = texture(u_decay, v_uv);
  if (u_mode == 2) {
    // Inverted ink fades back to clean paper
    vec3 paper = vec3(0.96, 0.95, 0.93);
    fragColor = vec4(mix(paper, prev.rgb, u_fade), 1.0);
  } else {
    // Phosphor fades down to pitch black
    fragColor = vec4(prev.rgb * u_fade, 1.0);
  }
}
`;

const SIM_COMPOSITE_FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_decay;
uniform sampler2D u_src;
uniform sampler2D u_orig;
uniform int u_mode;
uniform float u_mix;

void main() {
  vec4 simResult = texture(u_decay, v_uv);
  vec4 finalResult;

  if (u_mode == 3) {
    // Overlay on Source
    vec4 base = texture(u_src, v_uv);
    finalResult = vec4(base.rgb + simResult.rgb, base.a);
  } else {
    finalResult = simResult;
  }

  vec4 orig = texture(u_orig, v_uv);
  fragColor = mix(orig, finalResult, u_mix);
}
`;

type CompiledPass = {
  program: WebGLProgram;
  uniforms: UniformCache;
};

type NodeSimState = {
  stateTexA: WebGLTexture;
  stateTexB: WebGLTexture;
  stateFboA: WebGLFramebuffer;
  stateFboB: WebGLFramebuffer;
  currentIsA: boolean;
  initialized: boolean;
  decayTargetA: RenderTarget;
  decayTargetB: RenderTarget;
  decayIsA: boolean;
  decayWidth: number;
  decayHeight: number;
};

export class ParticleEngine {
  private gl: WebGL2RenderingContext;
  private nodes = new Map<string, NodeSimState>();
  private updatePass: CompiledPass;
  private pointPass: CompiledPass;
  private decayPass: CompiledPass;
  private compositePass: CompiledPass;
  private dummyVao: WebGLVertexArrayObject | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.updatePass = {
      program: createProgramWithShaders(gl, VERTEX_SOURCE, SIM_UPDATE_FRAG),
      uniforms: new Map(),
    };
    this.pointPass = {
      program: createProgramWithShaders(gl, SIM_POINT_VERT, SIM_POINT_FRAG),
      uniforms: new Map(),
    };
    this.decayPass = {
      program: createProgramWithShaders(gl, VERTEX_SOURCE, SIM_DECAY_FRAG),
      uniforms: new Map(),
    };
    this.compositePass = {
      program: createProgramWithShaders(gl, VERTEX_SOURCE, SIM_COMPOSITE_FRAG),
      uniforms: new Map(),
    };
    this.dummyVao = gl.createVertexArray();
  }

  private createFloatState(size: number): { texture: WebGLTexture; framebuffer: WebGLFramebuffer } {
    const gl = this.gl;
    gl.getExtension('EXT_color_buffer_float');

    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not create float texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error('Could not create float framebuffer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return { texture, framebuffer };
  }

  private initParticleData(texture: WebGLTexture, angleDeg: number): void {
    const gl = this.gl;
    const count = MAX_PARTICLES;
    const data = new Float32Array(count * 4);
    const rad = (angleDeg * Math.PI) / 180;

    for (let i = 0; i < count; i++) {
      const idx = i * 4;
      data[idx] = Math.random();
      data[idx + 1] = Math.random();
      data[idx + 2] = rad;
      data[idx + 3] = 0.8 + Math.random() * 0.4;
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PARTICLE_SIM_SIZE, PARTICLE_SIM_SIZE, gl.RGBA, gl.FLOAT, data);
  }

  private getNodeState(nodeId: string, width: number, height: number, angleDeg: number): NodeSimState {
    const gl = this.gl;
    let state = this.nodes.get(nodeId);

    if (!state) {
      const targetA = this.createFloatState(PARTICLE_SIM_SIZE);
      const targetB = this.createFloatState(PARTICLE_SIM_SIZE);
      this.initParticleData(targetA.texture, angleDeg);
      this.initParticleData(targetB.texture, angleDeg);

      const decayA = createTarget(gl, width, height);
      const decayB = createTarget(gl, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, decayA.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, decayB.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      state = {
        stateTexA: targetA.texture,
        stateTexB: targetB.texture,
        stateFboA: targetA.framebuffer,
        stateFboB: targetB.framebuffer,
        currentIsA: true,
        initialized: true,
        decayTargetA: decayA,
        decayTargetB: decayB,
        decayIsA: true,
        decayWidth: width,
        decayHeight: height,
      };
      this.nodes.set(nodeId, state);
      return state;
    }

    if (!state.initialized) {
      this.initParticleData(state.stateTexA, angleDeg);
      this.initParticleData(state.stateTexB, angleDeg);
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.decayTargetA.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.decayTargetB.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      state.initialized = true;
    }

    if (state.decayWidth !== width || state.decayHeight !== height) {
      gl.deleteFramebuffer(state.decayTargetA.framebuffer);
      gl.deleteTexture(state.decayTargetA.texture);
      gl.deleteFramebuffer(state.decayTargetB.framebuffer);
      gl.deleteTexture(state.decayTargetB.texture);

      state.decayTargetA = createTarget(gl, width, height);
      state.decayTargetB = createTarget(gl, width, height);
      state.decayWidth = width;
      state.decayHeight = height;

      gl.bindFramebuffer(gl.FRAMEBUFFER, state.decayTargetA.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.decayTargetB.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    return state;
  }

  public render(
    nodeId: string,
    inputTexture: WebGLTexture,
    origTexture: WebGLTexture,
    width: number,
    height: number,
    params: Record<string, ParamValue>,
    time: number,
    delta: number,
    seed: number,
    outTarget: RenderTarget,
  ): void {
    const gl = this.gl;
    const angle = (params.angle as number) ?? 270;
    const spread = (params.spread as number) ?? 0;
    const state = this.getNodeState(nodeId, width, height, angle);

    const emitter = (params.emitter as number) ?? 0;
    const origin = (params.origin as [number, number]) ?? [0.5, 0.5];
    const driver = (params.driver as number) ?? 0;
    const speed = (params.speed as number) ?? 1.0;
    const slowdown = (params.slowdown as number) ?? 1.2;
    const quantity = Math.max(10, Math.min(MAX_PARTICLES, Math.round((params.quantity as number) ?? 20000)));
    const size = (params.size as number) ?? 1.0;
    const shape = (params.shape as number) ?? 0;
    const color = (params.color as [number, number, number]) ?? [1, 1, 1];
    const brightness = (params.brightness as number) ?? 1.5;
    const trail = (params.trail as number) ?? 0.25;
    const mode = (params.mode as number) ?? 0;
    const mixVal = (params.mix as number) ?? 1.0;

    // --- Step 1: Simulation update pass ---
    const readTex = state.currentIsA ? state.stateTexA : state.stateTexB;
    const writeFbo = state.currentIsA ? state.stateFboB : state.stateFboA;

    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
    gl.viewport(0, 0, PARTICLE_SIM_SIZE, PARTICLE_SIM_SIZE);
    gl.useProgram(this.updatePass.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, readTex);
    gl.uniform1i(uniform(gl, this.updatePass.program, this.updatePass.uniforms, 'u_particles'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.uniform1i(uniform(gl, this.updatePass.program, this.updatePass.uniforms, 'u_src'), 1);

    gl.uniform2i(uniform(gl, this.updatePass.program, this.updatePass.uniforms, 'u_simSize'), PARTICLE_SIM_SIZE, PARTICLE_SIM_SIZE);
    gl.uniform2f(uniform(gl, this.updatePass.program, this.updatePass.uniforms, 'u_resolution'), width, height);
    gl.uniform1f(uniform(gl, this.updatePass.program, this.updatePass.uniforms, 'u_time'), time);
    gl.uniform1f(uniform(gl, this.updatePass.program, this.updatePass.uniforms, 'u_delta'), delta);
    gl.uniform1f(uniform(gl, this.updatePass.program, this.updatePass.uniforms, 'u_seed'), seed);
    gl.uniform1i(uniform(gl, this.updatePass.program, this.updatePass.uniforms, 'u_emitter'), emitter);
    gl.uniform2f(uniform(gl, this.updatePass.program, this.updatePass.uniforms, 'u_origin'), origin[0], origin[1]);
    gl.uniform1f(uniform(gl, this.updatePass.program, this.updatePass.uniforms, 'u_angle'), angle);
    gl.uniform1f(uniform(gl, this.updatePass.program, this.updatePass.uniforms, 'u_spread'), spread);
    gl.uniform1i(uniform(gl, this.updatePass.program, this.updatePass.uniforms, 'u_driver'), driver);
    gl.uniform1f(uniform(gl, this.updatePass.program, this.updatePass.uniforms, 'u_speed'), speed);
    gl.uniform1f(uniform(gl, this.updatePass.program, this.updatePass.uniforms, 'u_slowdown'), slowdown);

    drawQuad(gl);
    state.currentIsA = !state.currentIsA;
    const simResultTex = state.currentIsA ? state.stateTexA : state.stateTexB;

    // --- Step 2: Decay / accumulation pass ---
    const decayRead = state.decayIsA ? state.decayTargetA : state.decayTargetB;
    const decayWrite = state.decayIsA ? state.decayTargetB : state.decayTargetA;

    gl.bindFramebuffer(gl.FRAMEBUFFER, decayWrite.framebuffer);
    gl.viewport(0, 0, width, height);

    if (trail > 0.001) {
      gl.useProgram(this.decayPass.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, decayRead.texture);
      gl.uniform1i(uniform(gl, this.decayPass.program, this.decayPass.uniforms, 'u_decay'), 0);

      const fade = Math.pow(0.1, delta / Math.max(trail * 1.5, 0.02));
      gl.uniform1f(uniform(gl, this.decayPass.program, this.decayPass.uniforms, 'u_fade'), fade);
      gl.uniform1i(uniform(gl, this.decayPass.program, this.decayPass.uniforms, 'u_mode'), mode);
      drawQuad(gl);
    } else {
      if (mode === 2) {
        gl.clearColor(0.96, 0.95, 0.93, 1.0);
      } else {
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
      }
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // --- Step 3: Draw particle points ---
    gl.enable(gl.BLEND);
    if (mode === 2) {
      gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    } else {
      gl.blendFunc(gl.ONE, gl.ONE);
    }

    gl.useProgram(this.pointPass.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simResultTex);
    gl.uniform1i(uniform(gl, this.pointPass.program, this.pointPass.uniforms, 'u_particles'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.uniform1i(uniform(gl, this.pointPass.program, this.pointPass.uniforms, 'u_src'), 1);

    gl.uniform2i(uniform(gl, this.pointPass.program, this.pointPass.uniforms, 'u_simSize'), PARTICLE_SIM_SIZE, PARTICLE_SIM_SIZE);
    gl.uniform2f(uniform(gl, this.pointPass.program, this.pointPass.uniforms, 'u_resolution'), width, height);
    gl.uniform1f(uniform(gl, this.pointPass.program, this.pointPass.uniforms, 'u_size'), size);
    gl.uniform1i(uniform(gl, this.pointPass.program, this.pointPass.uniforms, 'u_shape'), shape);
    gl.uniform3f(uniform(gl, this.pointPass.program, this.pointPass.uniforms, 'u_color'), color[0], color[1], color[2]);
    gl.uniform1f(uniform(gl, this.pointPass.program, this.pointPass.uniforms, 'u_brightness'), brightness);
    gl.uniform1i(uniform(gl, this.pointPass.program, this.pointPass.uniforms, 'u_mode'), mode);

    if (this.dummyVao) gl.bindVertexArray(this.dummyVao);
    gl.drawArrays(gl.POINTS, 0, quantity);
    if (this.dummyVao) gl.bindVertexArray(null);

    gl.disable(gl.BLEND);
    state.decayIsA = !state.decayIsA;
    const finalDecayTex = decayWrite.texture;

    // --- Step 4: Composite to outTarget ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, outTarget.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.compositePass.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, finalDecayTex);
    gl.uniform1i(uniform(gl, this.compositePass.program, this.compositePass.uniforms, 'u_decay'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.uniform1i(uniform(gl, this.compositePass.program, this.compositePass.uniforms, 'u_src'), 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, origTexture);
    gl.uniform1i(uniform(gl, this.compositePass.program, this.compositePass.uniforms, 'u_orig'), 2);

    gl.uniform1i(uniform(gl, this.compositePass.program, this.compositePass.uniforms, 'u_mode'), mode);
    gl.uniform1f(uniform(gl, this.compositePass.program, this.compositePass.uniforms, 'u_mix'), mixVal);

    drawQuad(gl);
    gl.activeTexture(gl.TEXTURE0);
  }

  public reset(): void {
    for (const state of this.nodes.values()) {
      state.initialized = false;
    }
  }

  public prune(liveNodes: Set<string>): void {
    const gl = this.gl;
    for (const [nodeId, state] of this.nodes) {
      if (liveNodes.has(nodeId)) continue;
      gl.deleteFramebuffer(state.stateFboA);
      gl.deleteTexture(state.stateTexA);
      gl.deleteFramebuffer(state.stateFboB);
      gl.deleteTexture(state.stateTexB);
      gl.deleteFramebuffer(state.decayTargetA.framebuffer);
      gl.deleteTexture(state.decayTargetA.texture);
      gl.deleteFramebuffer(state.decayTargetB.framebuffer);
      gl.deleteTexture(state.decayTargetB.texture);
      this.nodes.delete(nodeId);
    }
  }

  public dispose(): void {
    const gl = this.gl;
    for (const state of this.nodes.values()) {
      gl.deleteFramebuffer(state.stateFboA);
      gl.deleteTexture(state.stateTexA);
      gl.deleteFramebuffer(state.stateFboB);
      gl.deleteTexture(state.stateTexB);
      gl.deleteFramebuffer(state.decayTargetA.framebuffer);
      gl.deleteTexture(state.decayTargetA.texture);
      gl.deleteFramebuffer(state.decayTargetB.framebuffer);
      gl.deleteTexture(state.decayTargetB.texture);
    }
    this.nodes.clear();

    if (this.dummyVao) {
      gl.deleteVertexArray(this.dummyVao);
      this.dummyVao = null;
    }

    gl.deleteProgram(this.updatePass.program);
    gl.deleteProgram(this.pointPass.program);
    gl.deleteProgram(this.decayPass.program);
    gl.deleteProgram(this.compositePass.program);
  }
}
