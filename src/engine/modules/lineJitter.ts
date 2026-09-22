import type { EffectDef } from '../effects';

/**
 * Per-line horizontal displacement -- tape tracking that has lost its grip.
 *
 * The distinguishing feature of tracking error against a smooth wobble is
 * that it is discontinuous: whole scanlines tear sideways independently of
 * the lines either side of them, and only some lines go at once. Density is
 * that "only some" -- at 1.0 every line tears, which reads as static rather
 * than as a tape fault.
 *
 * Held for whole steps at Rate rather than redrawn per frame, because tape
 * damage is a property of the tape and should persist for a beat, not boil
 * at the monitor's refresh.
 */
export const lineJitter: EffectDef = {
  id: 'lineJitter',
  label: 'Line Jitter',
  category: 'scan',
  animated: (params) => params.rate !== 0,
  params: [
    { kind: 'float', key: 'amount', label: 'Amount', min: 0, max: 0.2, step: 0.001, default: 0.02 },
    { kind: 'float', key: 'thickness', label: 'Thickness', min: 1, max: 20, step: 0.5, default: 2 },
    { kind: 'float', key: 'density', label: 'Density', min: 0, max: 1, step: 0.01, default: 0.3 },
    { kind: 'float', key: 'rate', label: 'Rate', min: 0, max: 60, step: 1, default: 12 },
    { kind: 'enum', key: 'edge', label: 'Edge', options: ['Clamp', 'Wrap', 'Black', 'Mirror'], default: 0 },
  ],
  fragment: `  float line = floor(v_uv.y * u_resolution.y / max(u_thickness, 1.0));
  float tick = floor(u_time * u_rate);
  vec2 key = vec2(line, tick + u_seed * 313.0);

  // Two independent draws off the same line: one decides whether this line
  // tears at all, the other how far. Reusing a single value would tie the
  // two together, so the rarest lines would also always be the wildest.
  // "active" is a reserved word in GLSL ES -- do not name anything that.
  float torn = step(1.0 - u_density, hash12(key));
  float offset = (hash12(key + vec2(0.5, 0.0)) - 0.5) * u_amount * torn;

  fragColor = sampleEdge(u_src, vec2(v_uv.x + offset, v_uv.y), u_edge);`,
};
