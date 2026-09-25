/**
 * Thin WebGL2 helpers shared by the pipeline.
 *
 * Every pass in this app is the same shape -- draw one full-screen quad,
 * sampling the previous stage -- so there is exactly one vertex shader and
 * no vertex buffers anywhere.
 */

/**
 * The full-screen triangle, generated from `gl_VertexID` alone.
 *
 * One oversized triangle rather than two quad triangles: it costs no vertex
 * data, and it has no interior diagonal where the rasterizer would shade the
 * seam twice.
 */
export const VERTEX_SOURCE = `#version 300 es
out vec2 v_uv;

void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const createContext = (canvas: HTMLCanvasElement): WebGL2RenderingContext | null =>
  canvas.getContext('webgl2', {
    alpha: true,
    // The canvas sits on glass, so the page shows through wherever the
    // letterboxed image does not reach. Straight (un-premultiplied) alpha
    // matches what the shaders write out.
    premultipliedAlpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });

const compileShader = (gl: WebGL2RenderingContext, type: number, source: string): WebGLShader => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    // Number the source so the line the driver names is findable, which
    // matters once effect bodies are being written by hand.
    const numbered = source
      .split('\n')
      .map((line, i) => `${String(i + 1).padStart(3, ' ')} | ${line}`)
      .join('\n');
    throw new Error(`Shader compile failed: ${log}\n${numbered}`);
  }
  return shader;
};

/** Link a program from explicit vertex and fragment sources. */
export const createProgramWithShaders = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram => {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('Could not create program');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown error';
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  return program;
};

/** Link a program from the shared vertex shader and a fragment source. */
export const createProgram = (gl: WebGL2RenderingContext, fragmentSource: string): WebGLProgram =>
  createProgramWithShaders(gl, VERTEX_SOURCE, fragmentSource);

/** Uniform locations, looked up once and reused every frame. */
export type UniformCache = Map<string, WebGLUniformLocation | null>;

export const uniform = (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  cache: UniformCache,
  name: string,
): WebGLUniformLocation | null => {
  if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
  return cache.get(name) ?? null;
};

/** Draw the full-screen triangle. Assumes a program is already bound. */
export const drawQuad = (gl: WebGL2RenderingContext): void => {
  gl.drawArrays(gl.TRIANGLES, 0, 3);
};
