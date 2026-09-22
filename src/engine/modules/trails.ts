import type { EffectDef } from '../effects';

/**
 * Phosphor persistence: the frame before this one, faded, still showing.
 *
 * Decay is per-sixtieth-of-a-second and raised to the frame's own delta, so
 * a trail lasts the same wall-clock time at 30fps as at 120. Applying the
 * factor once per frame instead would make the effect a function of the
 * machine it is running on.
 *
 * Both modes are bounded, which for feedback is not a detail: Decay keeps
 * the brighter of the two, Blur is a leaky integrator. Adding the frames
 * together instead would compound every frame and go white in about a
 * second.
 */
export const trails: EffectDef = {
  id: 'trails',
  label: 'Trails',
  category: 'temporal',
  animated: true,
  feedback: true,
  params: [
    { kind: 'float', key: 'decay', label: 'Decay', min: 0, max: 0.99, step: 0.005, default: 0.85 },
    { kind: 'enum', key: 'mode', label: 'Mode', options: ['Decay', 'Blur'], default: 0 },
    { kind: 'color', key: 'tint', label: 'Tint', default: [1, 1, 1] },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  vec4 prev = texture(u_prev, v_uv);

  float k = pow(clamp(u_decay, 0.0, 0.9999), u_delta * 60.0);
  vec3 faded = prev.rgb * u_tint;

  // Decay: a phosphor that keeps glowing where the picture was bright.
  // Blur: every frame leaks into the next, which smears motion instead.
  vec3 c = (u_mode == 0) ? max(src.rgb, faded * k) : mix(src.rgb, faded, k);

  fragColor = vec4(c, src.a);`,
};
