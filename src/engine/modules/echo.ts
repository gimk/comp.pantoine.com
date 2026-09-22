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
 * Persistence is a time -- how long until a ghost has faded to a tenth --
 * so the slider is linear in how far the stack reaches. Expressed as a
 * per-frame multiplier instead, every useful value sits in the last few
 * hundredths of the travel.
 *
 * Keeping the brighter of the two rather than crossfading leaves the live
 * picture crisp with the ghosts trailing off it, which is what multipath
 * looks like; a crossfade would instead fade the picture itself out behind
 * its own history.
 *
 * There is deliberately no separate strength: the ghost is fed back through
 * this same node, so anything scaling it compounds frame after frame and
 * becomes another decay control. Two knobs that both set the decay rate is
 * one knob and a lie.
 */
export const echo: EffectDef = {
  id: 'echo',
  label: 'Echo',
  category: 'temporal',
  animated: true,
  feedback: true,
  params: [
    { kind: 'vec2', key: 'offset', label: 'Offset', min: -64, max: 64, step: 0.5, default: [8, 0] },
    { kind: 'float', key: 'persistence', label: 'Persistence (s)', min: 0.05, max: 4, step: 0.05, default: 0.5 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  vec2 shift = u_offset / max(u_resolution, vec2(1.0));
  vec3 ghost = texture(u_prev, v_uv - shift).rgb;

  float k = pow(0.1, u_delta / max(u_persistence, 0.001));
  fragColor = vec4(max(src.rgb, ghost * k), src.a);`,
};
