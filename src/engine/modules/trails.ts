import type { EffectDef } from '../effects';

/**
 * Phosphor persistence: the frame before this one, faded, still showing.
 *
 * Persistence is how long the trail takes to fall to a tenth, in seconds,
 * rather than a per-frame multiplier. Those are the same control expressed
 * two ways, but only one of them is usable: as a multiplier, half the
 * slider covers under ten frames and everything worth having is squeezed
 * into the last few hundredths.
 *
 * Deriving the per-frame factor from the frame's own delta also means a
 * trail lasts the same wall-clock time at 30fps as at 120, instead of being
 * a function of the machine it is running on.
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
    { kind: 'float', key: 'persistence', label: 'Persistence (s)', min: 0.05, max: 4, step: 0.05, default: 0.6 },
    { kind: 'enum', key: 'mode', label: 'Mode', options: ['Decay', 'Blur'], default: 0 },
    { kind: 'color', key: 'tint', label: 'Tint', default: [1, 1, 1] },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  vec4 prev = texture(u_prev, v_uv);

  // Retention per frame, such that after u_persistence seconds the trail
  // has fallen to a tenth -- whatever the frame rate happens to be.
  float k = pow(0.1, u_delta / max(u_persistence, 0.001));
  vec3 faded = prev.rgb * u_tint;

  // Decay: a phosphor that keeps glowing where the picture was bright.
  // Blur: every frame leaks into the next, which smears motion instead.
  vec3 c = (u_mode == 0) ? max(src.rgb, faded * k) : mix(src.rgb, faded, k);

  fragColor = vec4(c, src.a);`,
};
