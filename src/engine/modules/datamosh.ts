import type { EffectDef } from '../effects';

/**
 * Datamosh, approximated: the last frame's pixels dragged along with the
 * movement in the new one, in square blocks, instead of the new frame
 * being shown -- the smear a video gets when its keyframes are cut out and
 * motion is applied to a picture it was never meant for.
 *
 * A real datamosh replays the codec's own motion vectors, which a live
 * picture does not have. Here each block estimates its own: one step of
 * gradient optical flow at the block's centre, v = -It grad I / (|grad I|^2
 * + Smoothing). And it estimates it against this node's previous output,
 * not a clean previous frame -- so once the picture has started to drift,
 * its errors feed the next estimate and compound, which is where the
 * melting look comes from.
 *
 * Leak lets the live picture seep back in, per second. Keyframe snaps back
 * to the live picture on a timer, as a codec's I-frame does; 0 never does.
 * With the clock stopped every redraw shows the live picture, so an edit
 * upstream is never lost under a held smear.
 */
export const datamosh: EffectDef = {
  id: 'datamosh',
  label: 'Datamosh',
  category: 'temporal',
  animated: true,
  feedback: true,
  mixable: true,
  params: [
    { kind: 'float', key: 'blockSize', label: 'Block Size', min: 4, max: 64, step: 1, default: 16 },
    { kind: 'float', key: 'strength', label: 'Strength', min: 0, max: 4, step: 0.01, default: 1.5 },
    { kind: 'float', key: 'leak', label: 'Leak', min: 0, max: 1, step: 0.01, default: 0.05 },
    { kind: 'float', key: 'keyframe', label: 'Keyframe (s)', min: 0, max: 10, step: 0.1, default: 4 },
    { kind: 'float', key: 'smoothing', label: 'Smoothing', min: 0.01, max: 10, step: 0.01, default: 1 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  vec4 prev = texture(u_prev, v_uv);

  bool keyframe = u_keyframe > 0.0
    && floor(u_time / u_keyframe) != floor((u_time - u_delta) / u_keyframe);
  if (keyframe || u_delta <= 0.0 || prev.a == 0.0) {
    fragColor = src;
  } else {
    float block = max(u_blockSize * u_pixel_scale, 1.0);
    vec2 px = 1.0 / u_resolution;
    vec2 center = (floor(v_uv * u_resolution / block) + 0.5) * block * px;
    // Central differences a quarter of a block wide: wide enough to see
    // past noise, narrow enough to stay inside the block.
    float h = max(block * 0.25, 1.0);
    vec2 grad = vec2(
      luma(texture(u_src, center + vec2(h, 0.0) * px).rgb) - luma(texture(u_src, center - vec2(h, 0.0) * px).rgb),
      luma(texture(u_src, center + vec2(0.0, h) * px).rgb) - luma(texture(u_src, center - vec2(0.0, h) * px).rgb)
    ) / (2.0 * h);
    float dt = luma(texture(u_src, center).rgb) - luma(texture(u_prev, center).rgb);
    vec2 motion = -dt * grad / (dot(grad, grad) + u_smoothing * 0.001);
    float len = length(motion);
    if (len > block) motion *= block / len;

    vec4 moved = texture(u_prev, clamp(v_uv - motion * u_strength * px, 0.0, 1.0));
    float seep = 1.0 - pow(1.0 - min(u_leak, 0.999), u_delta);
    fragColor = mix(moved, src, u_leak >= 1.0 ? 1.0 : seep);
  }`,
};
