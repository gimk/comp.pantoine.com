import type { EffectDef } from '../effects';

/**
 * What moved since the last frame: the difference between this frame and
 * the one before, as a picture, a mask, a highlight over the picture, or
 * the picture cut out to only what moves. Wired into a diamond port it is
 * a field, so motion can drive any knob -- grain where things move, blur
 * where they do not.
 *
 * Two passes, the first kept as history. It stores this frame's input in
 * rgb, for the next frame to compare against, and the mask in alpha,
 * faded by Fade the way Trails fades, so movement leaves a tail. The
 * second draws the chosen output; every pass sees last frame's history as
 * `u_prev`, so it can still work out the raw difference itself.
 *
 * Alpha holds the mask lifted off zero by one step, so an alpha of 0 only
 * ever means the history is empty -- the very first frame, which would
 * otherwise compare against black and read as all movement.
 */
const STEP = '(1.0 / 255.0)';

const DETECT = `  vec4 src = texture(u_src, v_uv);
  vec4 prev = texture(u_prev, v_uv);
  bool empty = prev.a < 0.5 * ${STEP};
  float prevMask = empty ? 0.0 : (prev.a - ${STEP}) / (1.0 - ${STEP});
  float change = empty ? 0.0 : luma(abs(src.rgb - prev.rgb)) * u_gain;
  float now = smoothstep(u_threshold, u_threshold + max(u_softness, 0.001), change);
  float k = u_fade > 0.0 ? pow(0.1, u_delta / u_fade) : 0.0;
  float mask = max(now, prevMask * k);
  fragColor = vec4(src.rgb, mix(${STEP}, 1.0, mask));`;

const RENDER = `  vec4 orig = texture(u_orig, v_uv);
  vec4 prev = texture(u_prev, v_uv);
  float mask = (texture(u_src, v_uv).a - ${STEP}) / (1.0 - ${STEP});
  mask = sat(mask);
  if (u_output == 0) {
    bool empty = prev.a < 0.5 * ${STEP};
    vec3 diff = empty ? vec3(0.0) : abs(orig.rgb - prev.rgb) * u_gain;
    fragColor = vec4(sat(diff), 1.0);
  } else if (u_output == 1) {
    fragColor = vec4(vec3(mask), 1.0);
  } else if (u_output == 2) {
    fragColor = vec4(mix(orig.rgb, u_color, mask), orig.a);
  } else {
    fragColor = vec4(orig.rgb, orig.a * mask);
  }`;

export const motionDetect: EffectDef = {
  id: 'motionDetect',
  label: 'Motion Detect',
  category: 'temporal',
  animated: true,
  feedback: true,
  feedbackPass: 0,
  mixable: true,
  params: [
    { kind: 'float', key: 'threshold', label: 'Threshold', min: 0, max: 0.5, step: 0.005, default: 0.06 },
    { kind: 'float', key: 'softness', label: 'Softness', min: 0, max: 0.5, step: 0.005, default: 0.06 },
    { kind: 'float', key: 'gain', label: 'Gain', min: 0.5, max: 10, step: 0.1, default: 2 },
    { kind: 'float', key: 'fade', label: 'Fade (s)', min: 0, max: 4, step: 0.05, default: 0.4 },
    {
      kind: 'enum',
      key: 'output',
      label: 'Output',
      options: ['Difference', 'Mask', 'Highlight', 'Cutout'],
      default: 1,
    },
    {
      kind: 'color',
      key: 'color',
      label: 'Color',
      default: [1, 0.2, 0.3],
      activeWhen: (params) => params.output === 2,
    },
  ],
  fragment: [DETECT, RENDER],
};
