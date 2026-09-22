/**
 * GLSL helpers prepended to every effect body.
 *
 * These exist so that "analog" modules -- grain, dropouts, burn maps, tape
 * jitter -- do not each ship their own copy of a hash function that drifts
 * subtly from its neighbours. One noise basis everywhere means two modules
 * dialed to the same scale actually agree.
 *
 * Always prepended rather than opted into per effect: GLSL compilers drop
 * unreferenced functions, so the cost is compile time rather than runtime.
 * If that compile time ever shows up with a large graph, this is the thing
 * to make opt-in.
 */
export const STDLIB = `
const float TAU = 6.28318530718;

float sat(float x) { return clamp(x, 0.0, 1.0); }

/** Rec. 709 luma -- perceived brightness, not a flat channel average. */
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/*
 * Hashes after Dave Hoskins. Chosen over the classic sin(dot(p, k)) trick
 * because that one banks on sin() overflowing identically on every driver,
 * which it does not -- it visibly falls apart on some mobile GPUs.
 */
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

/** Smoothed lattice noise in roughly 0..1. */
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/*
 * Fractal sum. The loop is bounded by a constant and broken early rather
 * than run to a uniform, since a uniform bound is what stops a driver from
 * unrolling and costs far more than the octaves saved.
 *
 * The 2.02 lacunarity is deliberately off 2.0: an exact doubling lines every
 * octave up on the same lattice points and leaves a visible grid.
 */
float fbm(vec2 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * valueNoise(p);
    p *= 2.02;
    amp *= 0.5;
  }
  return sum;
}

/** Rotate hue about the grey axis, leaving luma untouched. */
vec3 hueRotate(vec3 c, float angle) {
  const vec3 k = vec3(0.57735027);
  float ca = cos(angle);
  return c * ca + cross(k, c) * sin(angle) + k * dot(k, c) * (1.0 - ca);
}

/** UV remapped so one unit is the same distance across and down. */
vec2 aspectUv(vec2 uv, vec2 resolution) {
  vec2 p = uv - 0.5;
  p.x *= resolution.x / max(resolution.y, 1.0);
  return p;
}

/**
 * Sampling for displaced UVs: 0 clamp, 1 wrap, 2 black, 3 mirror.
 *
 * Handled here rather than by the texture's wrap mode because every stage
 * writes into the same pair of ping-pong targets, so their wrap setting is
 * shared by the whole chain -- one module could not choose to wrap without
 * imposing it on all the others.
 */
vec4 sampleEdge(sampler2D tex, vec2 uv, int mode) {
  if (mode == 1) {
    uv = fract(uv);
  } else if (mode == 2) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  } else if (mode == 3) {
    uv = abs(fract(uv * 0.5) * 2.0 - 1.0);
  }
  return texture(tex, clamp(uv, 0.0, 1.0));
}

/**
 * One axis of a separable Gaussian.
 *
 * The tap count is fixed and the radius scales the spacing between taps,
 * rather than radius adding taps. That keeps the cost of a wide blur equal
 * to a narrow one -- the alternative makes the frame time depend on a
 * slider, which is how a chain becomes unusable the moment someone opens
 * one up. The trade is that very large radii start to show their taps.
 *
 * At radius 0 every tap lands on the same texel and this is the identity.
 */
vec4 blurAxis(sampler2D tex, vec2 uv, vec2 resolution, vec2 dir, float radius) {
  const int TAPS = 8;
  vec2 stepUv = dir * radius / (float(TAPS) * resolution);
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -TAPS; i <= TAPS; i++) {
    float t = float(i) / float(TAPS);
    float w = exp(-2.5 * t * t);
    sum += texture(tex, uv + stepUv * float(i)) * w;
    total += w;
  }
  return sum / total;
}

/**
 * Unit LFO in -1..1: 0 sine, 1 triangle, 2 square, 3 noise.
 *
 * Triangle and square are phase-aligned to the sine -- all four rise from
 * zero at phase 0 and peak at 0.25 -- so switching waveform changes the
 * shape of the motion without also jumping its position.
 */
float wave(float phase, int shape) {
  if (shape == 1) return abs(fract(phase - 0.25) * 4.0 - 2.0) - 1.0;
  if (shape == 2) return fract(phase) < 0.5 ? 1.0 : -1.0;
  if (shape == 3) return valueNoise(vec2(phase, 0.0)) * 2.0 - 1.0;
  return sin(phase * TAU);
}
`;
