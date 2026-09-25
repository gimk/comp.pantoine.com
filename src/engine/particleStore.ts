import type { LoadedImage } from './imageStore';
import { isPlaying, resetCount } from './clock';
import { useGraph } from '../state/store';
import { getImage } from './imageStore';
import type { ParamValue } from './effects';

export const PARTICLE_SIM_SIZE = 256;
export const MAX_PARTICLES = PARTICLE_SIM_SIZE * PARTICLE_SIM_SIZE; // 65,536

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
 * High-performance CPU downsampled image sampler for driver attributes
 * (luminance, red, green, blue, saturation).
 */
class LumaGrid {
  private grid: Uint8Array | null = null;
  private lastVersion = -1;
  private lastDriver = -1;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  public update(image: LoadedImage | undefined, driver: number): void {
    if (!image || !image.bitmap) {
      this.grid = null;
      return;
    }

    const versionKey = image.version;
    if (this.lastVersion === versionKey && this.lastDriver === driver && this.grid) {
      return;
    }
    this.lastVersion = versionKey;
    this.lastDriver = driver;

    try {
      if (!this.canvas) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 256;
        this.canvas.height = 256;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      }

      if (!this.ctx) return;
      this.ctx.clearRect(0, 0, 256, 256);
      this.ctx.drawImage(image.bitmap, 0, 0, 256, 256);
      const imgData = this.ctx.getImageData(0, 0, 256, 256).data;

      if (!this.grid) {
        this.grid = new Uint8Array(256 * 256);
      }

      for (let i = 0; i < 256 * 256; i++) {
        const r = imgData[i * 4 + 0];
        const g = imgData[i * 4 + 1];
        const b = imgData[i * 4 + 2];
        let val = 0;
        if (driver === 0) {
          // Luminance
          val = 0.299 * r + 0.587 * g + 0.114 * b;
        } else if (driver === 1) {
          // Red
          val = r;
        } else if (driver === 2) {
          // Green
          val = g;
        } else if (driver === 3) {
          // Blue
          val = b;
        } else if (driver === 4) {
          // Saturation
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          val = max === 0 ? 0 : ((max - min) / max) * 255;
        }
        this.grid[i] = Math.round(val);
      }
    } catch {
      this.grid = null;
    }
  }

  public sample(x: number, y: number): number {
    if (!this.grid) return 0.5;
    const gx = Math.min(255, Math.max(0, (x * 256) | 0));
    // ImageBitmap was decoded with flipY, so row 0 is bottom and row 255 is top.
    // In particle coordinates, y=0 is top and y=1 is bottom.
    const gy = Math.min(255, Math.max(0, ((1.0 - y) * 256) | 0));
    return this.grid[gy * 256 + gx] / 255.0;
  }
}

/**
 * Discrete particle simulation instance for a single graph node.
 * Stored centrally so all viewers display the exact same state,
 * and the simulation continues running whether a viewer is attached or not.
 */
export class ParticleSimulation {
  public readonly nodeId: string;
  public seed: number;
  /**
   * Continuous buffer of particle state: 4 floats per particle:
   * [0]: x in [0, 1] (-10 if dead/pending)
   * [1]: y in [0, 1] (-10 if dead/pending)
   * [2]: direction angle in radians
   * [3]: birth delay in seconds
   */
  public data: Float32Array;
  public params: ParticleParams = { ...DEFAULT_PARTICLE_PARAMS };
  public lumaGrid = new LumaGrid();
  public initialized = false;

  // Linear congruential generator for deterministic particle distributions
  private rngState: number;

  constructor(nodeId: string, seed: number) {
    this.nodeId = nodeId;
    this.seed = seed;
    this.rngState = Math.floor(Math.abs(seed) * 1000000) || 1234567;
    this.data = new Float32Array(MAX_PARTICLES * 4);
    this.reset();
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
    this.rngState = Math.floor(Math.abs(this.seed) * 1000000) || 1234567;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const idx = i * 4;
      this.data[idx + 0] = -10.0; // x: dead/outside
      this.data[idx + 1] = -10.0; // y: dead/outside
      this.data[idx + 2] = angleRad;
      this.data[idx + 3] = this.nextRandom() * delaySpan; // birthDelay for progressive fill
    }
    this.initialized = true;
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

  public step(dt: number): void {
    if (!this.initialized) this.reset();

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

      // 4. Sample luminance/driver for speed modulation
      let factor = 1.0;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        factor = this.lumaGrid.sample(x, y);
      }

      // Slower in brighter areas (bunches up particles into image contours)
      const speedMult = 1.0 / (1.0 + factor * slowdown * 4.0);
      const stepDist = this.params.speed * speedMult * dtClamped * 0.4;
      x += vx * stepDist;
      y += vy * stepDist;

      data[idx + 0] = x;
      data[idx + 1] = y;
      data[idx + 2] = angle;
    }
  }
}

/**
 * Central singleton simulation manager.
 * Owns simulations for each particleFlow node in the graph,
 * ticks them continuously when playing, and coordinates resets.
 */
class ParticleSimulationManager {
  private simulations = new Map<string, ParticleSimulation>();
  private lastTickTime = performance.now();
  private lastResetCount = resetCount();
  private loopRunning = false;

  constructor() {
    this.startLoop();
  }

  public getSimulation(nodeId: string, seed = 0): ParticleSimulation {
    let sim = this.simulations.get(nodeId);
    if (!sim) {
      sim = new ParticleSimulation(nodeId, seed);
      this.simulations.set(nodeId, sim);
    }
    return sim;
  }

  public reset(): void {
    for (const sim of this.simulations.values()) {
      sim.reset();
    }
  }

  public prune(liveNodes: Set<string>): void {
    for (const nodeId of this.simulations.keys()) {
      if (!liveNodes.has(nodeId)) {
        this.simulations.delete(nodeId);
      }
    }
  }

  private startLoop(): void {
    if (this.loopRunning || typeof window === 'undefined') return;
    this.loopRunning = true;

    const tick = (now: number) => {
      // 1. Handle transport resets
      const currentResets = resetCount();
      if (currentResets !== this.lastResetCount) {
        this.lastResetCount = currentResets;
        this.reset();
      }

      // 2. Compute delta
      const delta = Math.min((now - this.lastTickTime) / 1000, 0.05);
      this.lastTickTime = now;

      // 3. Step simulations if transport is playing
      if (isPlaying() && delta > 0.0001) {
        this.stepAll(delta);
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  public stepAll(dt: number): void {
    const state = useGraph.getState();
    const nodes = state.nodes;
    const edges = state.edges;

    // Prune deleted nodes
    const activeNodeIds = new Set(nodes.map((n) => n.id));
    this.prune(activeNodeIds);

    for (const node of nodes) {
      if (node.type !== 'effect' || node.data.effectId !== 'particleFlow') continue;

      const sim = this.getSimulation(node.id);
      sim.setParams(node.data.params);

      // Find source image for luminance sampling
      let currentId: string | undefined = node.id;
      let sourceImageId: string | null = null;
      const visited = new Set<string>();

      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const inEdge = edges.find((e) => e.target === currentId && !e.targetHandle);
        if (!inEdge) break;
        const upstream = nodes.find((n) => n.id === inEdge.source);
        if (!upstream) break;
        if (upstream.type === 'image') {
          sourceImageId = upstream.id;
          break;
        }
        currentId = upstream.id;
      }

      if (sourceImageId) {
        const image = getImage(sourceImageId);
        sim.lumaGrid.update(image, sim.params.driver);
      }

      sim.step(dt);
    }
  }
}

export const particleManager = new ParticleSimulationManager();
