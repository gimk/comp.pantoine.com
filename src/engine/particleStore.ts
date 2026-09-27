import type { ParamValue } from './effects';

export const PARTICLE_SIM_SIZE = 256;
export const MAX_PARTICLES = PARTICLE_SIM_SIZE * PARTICLE_SIM_SIZE; // 65,536

/** Side of the square grid the speed driver is sampled from. */
export const DRIVER_GRID_SIZE = 256;

/** Longest single simulation step, in seconds. Longer advances are split. */
export const SIM_MAX_STEP = 1 / 60;

/**
 * How much history a simulation is given when asked for a moment far from
 * where it is. Particles are born over a few seconds and take a few more to
 * settle into the picture, so this is enough to reach something close to
 * the steady state -- and short enough that jumping to t = 900 costs a
 * fraction of a second rather than replaying fifteen minutes.
 */
export const SIM_PREROLL_SECONDS = 6;

export type ParticleParams = {
  angle: number;
  spread: number;
  emitter: number;
  origin: [number, number];
  speed: number;
  driver: number;
  slowdown: number;
  quantity: number;
  size: number;
  shape: number;
  color: [number, number, number];
  brightness: number;
  trail: number;
  mode: number;
  mix: number;
};

export const DEFAULT_PARTICLE_PARAMS: ParticleParams = {
  angle: 270,
  spread: 0,
  emitter: 0,
  origin: [0.5, 0.5],
  speed: 1.0,
  driver: 0,
  slowdown: 1.2,
  quantity: 20000,
  size: 1.0,
  shape: 0,
  color: [1, 1, 1],
  brightness: 1.5,
  trail: 0.25,
  mode: 0,
  mix: 1.0,
};

/**
 * Speed drivers, in the order particleFlow's menu lists them. The menu
 * stores the index, so this order is part of the document format.
 */
export const DRIVERS = [
  'luminance',
  'invertedLuma',
  'saturation',
  'edges',
  'red',
  'green',
  'blue',
  'hue',
] as const;

const luma = (r: number, g: number, b: number): number => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/**
 * Reduce an RGBA picture to one driver value per cell, each in [0, 1].
 *
 * `rgba` is `size * size` pixels, rows in GL order (bottom row first) --
 * straight off `readPixels`. Pure, so it can be tested without a GPU.
 */
export const computeDriverGrid = (
  rgba: Uint8Array,
  size: number,
  driver: number,
  out: Float32Array = new Float32Array(size * size),
): Float32Array => {
  const count = size * size;
  const kind = DRIVERS[Math.round(driver)] ?? 'luminance';

  if (kind === 'edges') {
    // Sobel on luma. The kernel's largest response to a hard black/white
    // edge is 4, so halving it makes a clean edge read as 1 while leaving
    // soft gradients down in the low values where they belong.
    const l = new Float32Array(count);
    for (let i = 0; i < count; i++) l[i] = luma(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    const at = (x: number, y: number): number =>
      l[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gx =
          at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
        const gy =
          at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
        out[y * size + x] = Math.min(1, Math.hypot(gx, gy) / 2);
      }
    }
    return out;
  }

  for (let i = 0; i < count; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    let value: number;
    switch (kind) {
      case 'invertedLuma':
        value = 1 - luma(r, g, b);
        break;
      case 'saturation': {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        value = max === 0 ? 0 : (max - min) / max;
        break;
      }
      case 'red':
        value = r / 255;
        break;
      case 'green':
        value = g / 255;
        break;
      case 'blue':
        value = b / 255;
        break;
      case 'hue': {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        if (d === 0) {
          value = 0;
        } else {
          let h: number;
          if (max === r) h = ((g - b) / d + 6) % 6;
          else if (max === g) h = (b - r) / d + 2;
          else h = (r - g) / d + 4;
          value = h / 6;
        }
        break;
      }
      default:
        value = luma(r, g, b);
    }
    out[i] = value;
  }
  return out;
};

/** The driver, sampled at a particle's position. */
export class DriverGrid {
  private grid: Float32Array | null = null;

  public update(rgba: Uint8Array, driver: number): void {
    this.grid = computeDriverGrid(rgba, DRIVER_GRID_SIZE, driver, this.grid ?? undefined);
  }

  public clear(): void {
    this.grid = null;
  }

  public sample(x: number, y: number): number {
    if (!this.grid) return 0.5;
    const n = DRIVER_GRID_SIZE;
    const gx = Math.min(n - 1, Math.max(0, (x * n) | 0));
    // The grid is in GL order, row 0 at the bottom; particle y runs down.
    const gy = Math.min(n - 1, Math.max(0, ((1.0 - y) * n) | 0));
    return this.grid[gy * n + gx];
  }
}

/**
 * The particle simulation for one node, as a function of time.
 *
 * `advanceTo` moves it to a requested moment in steps of at most
 * SIM_MAX_STEP, restarting (with a bounded pre-roll) when asked to go
 * backwards or to jump far ahead. That makes its state depend only on the
 * seed, the params and the sequence of times it was shown -- not on wall
 * time -- so an export is reproducible, a paused viewer stays put, and two
 * viewers watching the same moment agree.
 */
export class ParticleSimulation {
  public readonly seed: number;
  /**
   * Continuous buffer of particle state: 4 floats per particle:
   * [0]: x in [0, 1] (-10 if dead/pending)
   * [1]: y in [0, 1] (-10 if dead/pending)
   * [2]: direction angle in radians
   * [3]: birth delay in seconds
   */
  public data: Float32Array;
  public params: ParticleParams = { ...DEFAULT_PARTICLE_PARAMS };
  public driverGrid = new DriverGrid();
  /** The moment the particles are at, in seconds; null before the first advance. */
  public time: number | null = null;
  /** Bumped whenever `data` changes, so a renderer can skip re-uploading it. */
  public version = 0;

  // Linear congruential generator for deterministic particle distributions
  private rngState: number;

  constructor(seed: number) {
    this.seed = seed;
    this.rngState = this.initialRngState();
    this.data = new Float32Array(MAX_PARTICLES * 4);
    this.reset();
  }

  private initialRngState(): number {
    return Math.floor(Math.abs(this.seed) * 1000000) || 1234567;
  }

  private nextRandom(): number {
    this.rngState = (this.rngState * 16807 + 11) % 2147483647;
    return (this.rngState - 1) / 2147483646;
  }

  public reset(): void {
    const speed = this.params.speed;
    const angleRad = (this.params.angle * Math.PI) / 180.0;
    const delaySpan = 3.5 / Math.max(Math.abs(speed), 0.25);

    // Re-seed deterministic PRNG so reset always produces consistent pattern
    this.rngState = this.initialRngState();

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const idx = i * 4;
      this.data[idx + 0] = -10.0; // x: dead/outside
      this.data[idx + 1] = -10.0; // y: dead/outside
      this.data[idx + 2] = angleRad;
      this.data[idx + 3] = this.nextRandom() * delaySpan; // birthDelay for progressive fill
    }
    this.version += 1;
  }

  public setParams(newParams: Record<string, ParamValue>): void {
    if (newParams.angle !== undefined) this.params.angle = Number(newParams.angle);
    if (newParams.spread !== undefined) this.params.spread = Number(newParams.spread);
    if (newParams.emitter !== undefined) this.params.emitter = Math.round(Number(newParams.emitter));
    if (newParams.origin !== undefined) this.params.origin = newParams.origin as [number, number];
    if (newParams.speed !== undefined) this.params.speed = Number(newParams.speed);
    if (newParams.driver !== undefined) this.params.driver = Math.round(Number(newParams.driver));
    if (newParams.slowdown !== undefined) this.params.slowdown = Number(newParams.slowdown);
    if (newParams.quantity !== undefined) this.params.quantity = Math.max(10, Math.min(MAX_PARTICLES, Math.round(Number(newParams.quantity))));
    if (newParams.size !== undefined) this.params.size = Number(newParams.size);
    if (newParams.shape !== undefined) this.params.shape = Math.round(Number(newParams.shape));
    if (newParams.color !== undefined) this.params.color = newParams.color as [number, number, number];
    if (newParams.brightness !== undefined) this.params.brightness = Number(newParams.brightness);
    if (newParams.trail !== undefined) this.params.trail = Number(newParams.trail);
    if (newParams.mode !== undefined) this.params.mode = Math.round(Number(newParams.mode));
    if (newParams.mix !== undefined) this.params.mix = Number(newParams.mix);
  }

  /** Forget where the particles were; the next advance starts them afresh. */
  public restart(): void {
    this.time = null;
  }

  /**
   * Bring the particles to `time`.
   *
   * Returns how many seconds of motion were simulated -- zero for a redraw
   * at the moment already reached, which is how a renderer knows not to
   * fade or accumulate anything -- and whether the particles were reset.
   */
  public advanceTo(time: number, preroll: number = SIM_PREROLL_SECONDS): { advanced: number; restarted: boolean } {
    const target = Math.max(0, time);
    let restarted = false;
    if (this.time === null || target < this.time - 1e-9 || target - this.time > preroll) {
      this.reset();
      this.time = Math.max(0, target - preroll);
      restarted = true;
    }
    const span = target - this.time;
    if (span <= 1e-9) return { advanced: 0, restarted };

    // Equal sub-steps rather than a fixed grid plus remainder, so a steady
    // frame rate moves the particles by the same amount every frame.
    const steps = Math.ceil(span / SIM_MAX_STEP - 1e-9);
    const dt = span / steps;
    for (let i = 0; i < steps; i++) this.step(dt);
    this.time = target;
    return { advanced: span, restarted };
  }

  public step(dt: number): void {
    const dtClamped = Math.min(Math.max(dt, 0.0005), 0.06);
    const rad = (this.params.angle * Math.PI) / 180.0;

    // Standard Cartesian angle where 270 deg is downwards (sin(270) = -1 => dy = +1 downwards)
    let dirX = Math.cos(rad);
    let dirY = -Math.sin(rad);
    const dirLen = Math.hypot(dirX, dirY);
    if (dirLen < 0.001) {
      dirX = 0;
      dirY = 1;
    } else {
      dirX /= dirLen;
      dirY /= dirLen;
    }

    const effDirX = this.params.speed >= 0 ? dirX : -dirX;
    const effDirY = this.params.speed >= 0 ? dirY : -dirY;
    const perpX = -effDirY;
    const perpY = effDirX;

    // Upstream edge center calculation for edge sweep emitter
    const absDx = Math.abs(effDirX);
    const absDy = Math.abs(effDirY);
    let distToEdge = 1e5;
    if (absDx > 0.0001) distToEdge = Math.min(distToEdge, 0.5 / absDx);
    if (absDy > 0.0001) distToEdge = Math.min(distToEdge, 0.5 / absDy);

    const edgeCenterX = 0.5 - effDirX * distToEdge;
    const edgeCenterY = 0.5 - effDirY * distToEdge;

    const speedParam = Math.abs(this.params.speed);
    const speedFactor = Math.max(speedParam, 0.25);
    const slowdown = this.params.slowdown;
    const count = this.params.quantity;

    const data = this.data;

    for (let i = 0; i < count; i++) {
      const idx = i * 4;
      let x = data[idx + 0];
      let y = data[idx + 1];
      let angle = data[idx + 2];
      let birthDelay = data[idx + 3];

      // 1. Birth delay: particle has not entered frame yet
      if (birthDelay > 0) {
        birthDelay -= dtClamped * speedFactor;
        if (birthDelay > 0) {
          data[idx + 3] = birthDelay;
          continue;
        }
        birthDelay = 0;
        data[idx + 3] = 0;
        x = -10.0;
        y = -10.0;
      }

      // 2. Check out of bounds / need spawn
      const outOfBounds = x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02;
      if (outOfBounds) {
        const rx = this.nextRandom();
        const ry = this.nextRandom();

        if (this.params.emitter === 0) {
          // Edge sweep: All particles enter from upstream boundary in exact same direction
          angle = rad;
          const spawnX = edgeCenterX + perpX * ((rx - 0.5) * 1.4);
          const spawnY = edgeCenterY + perpY * ((rx - 0.5) * 1.4);
          x = Math.max(0, Math.min(1, spawnX)) + effDirX * 0.005;
          y = Math.max(0, Math.min(1, spawnY)) + effDirY * 0.005;
        } else if (this.params.emitter === 1) {
          // Point cone
          x = this.params.origin[0] + effDirX * 0.005;
          y = this.params.origin[1] + effDirY * 0.005;
          const spreadRad = (Math.max(this.params.spread, 0) * Math.PI) / 180.0;
          angle = rad + (rx - 0.5) * spreadRad;
        } else if (this.params.emitter === 2) {
          // Point 360 radial
          x = this.params.origin[0];
          y = this.params.origin[1];
          angle = rx * Math.PI * 2.0;
        } else {
          // Fullscreen
          x = rx;
          y = ry;
          angle = rad;
        }
      }

      // 3. Movement vector: all particles move in a strict straight line
      let vx: number;
      let vy: number;
      if (this.params.emitter === 0) {
        vx = dirX;
        vy = dirY;
      } else {
        vx = Math.cos(angle);
        vy = -Math.sin(angle);
      }

      // 4. Sample the driver for speed modulation
      let factor = 1.0;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        factor = this.driverGrid.sample(x, y);
      }

      // Slower where the driver is high (bunches up particles into image contours)
      const speedMult = 1.0 / (1.0 + factor * slowdown * 4.0);
      const stepDist = this.params.speed * speedMult * dtClamped * 0.4;
      x += vx * stepDist;
      y += vy * stepDist;

      data[idx + 0] = x;
      data[idx + 1] = y;
      data[idx + 2] = angle;
    }
    this.version += 1;
  }
}
