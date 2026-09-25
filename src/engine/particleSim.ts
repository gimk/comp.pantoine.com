import type { ParamValue } from './effects';
import { createProgramWithShaders, drawQuad, uniform, VERTEX_SOURCE, type UniformCache } from './gl';
import { createTarget, type RenderTarget } from './targets';
import { particleManager, PARTICLE_SIM_SIZE, MAX_PARTICLES } from './particleStore';

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
  vec4 particles = texture(u_decay, v_uv);
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

type CompiledPass = {
  program: WebGLProgram;
  uniforms: UniformCache;
};

type NodeSimState = {
  stateTex: WebGLTexture;
  decayTargetA: RenderTarget;
  decayTargetB: RenderTarget;
  decayIsA: boolean;
  decayWidth: number;
  decayHeight: number;
};

export class ParticleEngine {
  private gl: WebGL2RenderingContext;
  private pointPass: CompiledPass;
  private decayPass: CompiledPass;
  private compositePass: CompiledPass;
  private nodes = new Map<string, NodeSimState>();
  private dummyVao: WebGLVertexArrayObject | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;

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

  private getNodeState(nodeId: string, width: number, height: number): NodeSimState {
    const gl = this.gl;
    let state = this.nodes.get(nodeId);

    if (!state) {
      const tex = gl.createTexture();
      if (!tex) throw new Error('Could not create particle state texture');
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, PARTICLE_SIM_SIZE, PARTICLE_SIM_SIZE, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

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
        stateTex: tex,
        decayTargetA: decayA,
        decayTargetB: decayB,
        decayIsA: true,
        decayWidth: width,
        decayHeight: height,
      };
      this.nodes.set(nodeId, state);
      return state;
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
    _time: number,
    delta: number,
    seed: number,
    outTarget: RenderTarget,
  ): void {
    const gl = this.gl;
    const quantity = Math.max(10, Math.min(MAX_PARTICLES, Math.round((params.quantity as number) ?? 20000)));
    const size = (params.size as number) ?? 1.0;
    const shape = (params.shape as number) ?? 0;
    const color = (params.color as [number, number, number]) ?? [1, 1, 1];
    const brightness = (params.brightness as number) ?? 1.5;
    const trail = (params.trail as number) ?? 0.25;
    const mode = (params.mode as number) ?? 0;
    const mixVal = (params.mix as number) ?? 1.0;

    const state = this.getNodeState(nodeId, width, height);

    // 1. Synchronize with central simulation store for this node
    const sim = particleManager.getSimulation(nodeId, seed);
    sim.setParams(params);

    // Upload central particle positions to GPU
    gl.bindTexture(gl.TEXTURE_2D, state.stateTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PARTICLE_SIM_SIZE, PARTICLE_SIM_SIZE, gl.RGBA, gl.FLOAT, sim.data);

    // 2. Decay / accumulation pass
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

    // 3. Draw particle points
    gl.enable(gl.BLEND);
    if (mode === 2) {
      gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    } else {
      gl.blendFunc(gl.ONE, gl.ONE);
    }

    gl.useProgram(this.pointPass.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.stateTex);
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

    // 4. Composite to outTarget
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
    const gl = this.gl;
    for (const state of this.nodes.values()) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.decayTargetA.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.decayTargetB.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  public prune(liveNodes: Set<string>): void {
    const gl = this.gl;
    for (const [nodeId, state] of this.nodes) {
      if (liveNodes.has(nodeId)) continue;
      gl.deleteTexture(state.stateTex);
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
      gl.deleteTexture(state.stateTex);
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

    gl.deleteProgram(this.pointPass.program);
    gl.deleteProgram(this.decayPass.program);
    gl.deleteProgram(this.compositePass.program);
  }
}
