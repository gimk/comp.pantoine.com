import type { EffectDef } from '../effects';

/**
 * Particle Flow (Real GPU Particle Simulator / Luminance Speed Modulation).
 *
 * Real discrete particle simulator:
 * - Particles are generated continuously at the emitter (Edge, Point Cone, Point 360°, Fullscreen).
 * - Particles move strictly along straight paths.
 * - Local speed is modulated by the selected driver (Luminance, Saturation, Edges, RGB, Hue):
 *   slowing down in driver peaks causes physical bunching and particle congestion that forms the image.
 * - When particles reach the frame boundary, they exit and respawn at the emitter.
 * - Particles are rendered as crisp integer point pixels with configurable size and phosphor decay trails.
 */
export const particleFlow: EffectDef = {
  id: 'particleFlow',
  label: 'Particle Flow',
  category: 'crt',
  animated: (params) => params.speed !== 0 || (params.trail as number) > 0,
  mixable: true,
  params: [
    {
      kind: 'enum',
      key: 'emitter',
      label: 'Emitter Shape',
      options: ['Edge (Directional)', 'Point (Directional Cone)', 'Point (Radial 360°)', 'Fullscreen Drift'],
      default: 0,
    },
    { kind: 'float', key: 'angle', label: 'Direction Angle', min: 0, max: 360, step: 1, default: 270 },
    { kind: 'vec2', key: 'origin', label: 'Emitter Origin', min: 0, max: 1, step: 0.01, default: [0.5, 0.5] },
    { kind: 'float', key: 'spread', label: 'Cone Spread', min: 0, max: 360, step: 2, default: 0 },
    {
      kind: 'enum',
      key: 'driver',
      label: 'Speed Driver',
      options: ['Luminance', 'Inverted Luma', 'Saturation', 'Edges', 'Red', 'Green', 'Blue', 'Hue'],
      default: 0,
    },
    { kind: 'float', key: 'speed', label: 'Travel Speed', min: -4, max: 4, step: 0.05, default: 1.0 },
    { kind: 'float', key: 'slowdown', label: 'Driver Slowdown', min: 0.0, max: 3.0, step: 0.02, default: 1.2 },
    { kind: 'float', key: 'quantity', label: 'Particle Quantity', min: 500, max: 65536, step: 500, default: 20000 },
    { kind: 'float', key: 'size', label: 'Particle Size (px)', min: 1.0, max: 8.0, step: 0.5, default: 1.0 },
    {
      kind: 'enum',
      key: 'shape',
      label: 'Particle Shape',
      options: ['Pixel (Square)', 'Phosphor (Circle Dot)'],
      default: 0,
    },
    { kind: 'color', key: 'color', label: 'Phosphor Color', default: [1, 1, 1] },
    { kind: 'float', key: 'brightness', label: 'Brightness', min: 0.2, max: 4.0, step: 0.05, default: 1.5 },
    { kind: 'float', key: 'trail', label: 'Trail / Persistence', min: 0.0, max: 1.0, step: 0.02, default: 0.25 },
    {
      kind: 'enum',
      key: 'mode',
      label: 'Output Mode',
      options: ['CRT Phosphor (Black BG)', 'Source Tinted (Black BG)', 'Inverted Ink (White BG)', 'Overlay on Source'],
      default: 0,
    },
  ],
  fragment: `  // Managed by dedicated GPU ParticleEngine in Pipeline
  vec4 baseCol = texture(u_src, v_uv);
  fragColor = baseCol;`,
};
