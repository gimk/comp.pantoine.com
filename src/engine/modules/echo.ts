import type { EffectDef } from '../effects';

/**
 * A displaced copy of the previous frame, laid back over this one -- the
 * multipath ghost of an aerial picking the same signal up twice.
 *
 * Because the ghost is taken from this node's own output, each frame's copy
 * is offset again from the last. One offset knob gives a receding stack of
 * ghosts rather than a single duplicate, which is what the real artefact
 * looks like.
 *
 * Written as a crossfade rather than an addition. Addition with feedback is
 * a geometric series, and at any useful strength it clips to white within a
 * second or two.
 */
export const echo: EffectDef = {
  id: 'echo',
  label: 'Echo',
  category: 'temporal',
  animated: true,
  feedback: true,
  params: [
    { kind: 'vec2', key: 'offset', label: 'Offset', min: -64, max: 64, step: 0.5, default: [8, 0] },
    { kind: 'float', key: 'decay', label: 'Decay', min: 0, max: 0.99, step: 0.005, default: 0.8 },
    { kind: 'float', key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  vec2 shift = u_offset / max(u_resolution, vec2(1.0));
  vec3 ghost = texture(u_prev, v_uv - shift).rgb;

  float k = pow(clamp(u_decay, 0.0, 0.9999), u_delta * 60.0);
  fragColor = vec4(mix(src.rgb, ghost, u_strength * k), src.a);`,
};
