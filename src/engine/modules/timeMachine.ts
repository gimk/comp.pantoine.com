import type { EffectDef } from '../effects';

/**
 * Time Machine, after TouchDesigner's: every pixel shows its input as it
 * was some time ago, and a second picture says how long ago.
 *
 * The node keeps its recent input in a cache (see timeCache.ts). The Time
 * input's brightness picks each pixel's delay: black reads Black Offset
 * seconds back, white reads White Offset, grey in between. A ramp gives
 * the slit-scan smear, a noise gives melting time, the picture's own luma
 * makes bright things lag. With nothing wired every pixel is Black Offset
 * behind -- a plain delay.
 *
 * Offsets are seconds of clock time, not frames, so a preview and an
 * export agree. How far back the node can reach is (Cache Frames - 1) /
 * Cache FPS; anything asked for further back gets the oldest frame held.
 * Frame Blend crossfades between the two cached frames either side of the
 * moment asked for, so a smooth ramp gives a smooth smear rather than
 * bands one cache frame wide.
 *
 * The cache is memory -- Cache Frames copies of the picture -- so it is
 * held at Half size by default, and shrunk further past a budget. A delay
 * of zero reads the live input at full size.
 */
export const timeMachine: EffectDef = {
  id: 'timeMachine',
  label: 'Time Machine',
  category: 'temporal',
  animated: true,
  mixable: true,
  inputs: [{ key: 'timeMap', label: 'Time' }],
  timeCache: (params) => ({
    frames: params.frames as number,
    fps: params.cacheFps as number,
    scale: [1, 0.5, 0.25][params.cacheSize as number] ?? 0.5,
  }),
  params: [
    { kind: 'float', key: 'blackOffset', label: 'Black Offset', min: 0, max: 8, step: 0.01, default: 0 },
    { kind: 'float', key: 'whiteOffset', label: 'White Offset', min: 0, max: 8, step: 0.01, default: 1 },
    { kind: 'bool', key: 'blend', label: 'Frame Blend', default: true },
    { kind: 'int', key: 'frames', label: 'Cache Frames', min: 2, max: 240, default: 60, cpu: true },
    { kind: 'float', key: 'cacheFps', label: 'Cache FPS', min: 1, max: 60, step: 1, default: 30, cpu: true },
    {
      kind: 'enum',
      key: 'cacheSize',
      label: 'Cache Size',
      options: ['Full', 'Half', 'Quarter'],
      default: 1,
      cpu: true,
    },
  ],
  fragment: `  float map = textureSize(u_timeMap, 0).x > 1 ? luma(texture(u_timeMap, v_uv).rgb) : 0.0;
  float delay = max(mix(u_blackOffset, u_whiteOffset, map), 0.0);

  // Where in the cache, in slots: now minus the delay, no older than the
  // oldest slot the ring still holds.
  float oldest = u_cache_head - u_cache_layers + 1.0;
  float at = max(u_cache_now - delay * u_cache_fps, oldest);
  vec4 current = texture(u_src, v_uv);

  if (at >= u_cache_head) {
    // The newest slot is this frame; read it live, at full size.
    fragColor = current;
  } else {
    float older = floor(at);
    vec4 a = texture(u_cache, vec3(v_uv, mod(older, u_cache_layers)));
    vec4 b = older + 1.0 >= u_cache_head
      ? current
      : texture(u_cache, vec3(v_uv, mod(older + 1.0, u_cache_layers)));
    fragColor = u_blend ? mix(a, b, at - older) : a;
  }`,
};
