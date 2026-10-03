import type { EffectDef } from '../effects';

/**
 * Holds each frame for a while before taking the next, so motion steps at
 * Hold FPS instead of running smooth: stop-motion, a choppy webcam, a
 * low-frame-rate music video. Strobe adds flashes on a beat of its own.
 *
 * Two passes, and the first is the one kept as history: it takes a fresh
 * frame when the clock crosses a hold boundary and otherwise hands back
 * the one it kept. The strobe is drawn after, in the second, so a flash is
 * never the frame that gets held. Strobe Rate is phased -- changing it mid
 * flash never jumps the beat.
 *
 * With the clock stopped -- paused, or scrubbing -- every redraw takes a
 * fresh frame, so an edit upstream shows instead of a stale held picture.
 */
const HOLD = `  vec4 src = texture(u_src, v_uv);
  vec4 prev = texture(u_prev, v_uv);
  float fps = max(u_holdFps, 0.001);
  bool crossed = floor(u_time * fps) != floor((u_time - u_delta) * fps);
  // History starts empty: nothing held yet means take this frame.
  bool fresh = crossed || u_delta <= 0.0 || prev.a == 0.0;
  fragColor = fresh ? src : prev;`;

const STROBE = `  vec4 c = texture(u_src, v_uv);
  if (u_strobe != 0 && fract(u_phase_rate) < u_duty) {
    if (u_strobe == 1) c.rgb = vec3(0.0);
    else if (u_strobe == 2) c.rgb = vec3(1.0);
    else c.rgb = 1.0 - c.rgb;
  }
  fragColor = c;`;

export const frameHold: EffectDef = {
  id: 'frameHold',
  label: 'Frame Hold',
  category: 'temporal',
  animated: true,
  feedback: true,
  feedbackPass: 0,
  mixable: true,
  params: [
    { kind: 'float', key: 'holdFps', label: 'Hold FPS', min: 1, max: 30, step: 0.5, default: 6 },
    { kind: 'enum', key: 'strobe', label: 'Strobe', options: ['Off', 'Black', 'White', 'Invert'], default: 0 },
    {
      kind: 'float',
      key: 'rate',
      label: 'Strobe Rate (Hz)',
      min: 0.1,
      max: 30,
      step: 0.1,
      default: 2,
      activeWhen: (params) => params.strobe !== 0,
    },
    {
      kind: 'float',
      key: 'duty',
      label: 'Duty',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.15,
      activeWhen: (params) => params.strobe !== 0,
    },
  ],
  fragment: [HOLD, STROBE],
};
