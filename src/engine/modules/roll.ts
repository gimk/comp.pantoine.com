import type { EffectDef } from '../effects';

/**
 * The picture sliding vertically through the frame, with the sync seam
 * visible where it wraps -- a set that has lost vertical hold.
 *
 * The seam is the point of the module. Scrolling alone just looks like a
 * pan; the dark torn line arriving with it is what says the signal has
 * slipped rather than the camera moved.
 *
 * Offset parks the roll at a chosen position, so the seam can be placed
 * deliberately with Speed at zero.
 */
export const roll: EffectDef = {
  id: 'roll',
  label: 'Roll',
  category: 'crt',
  animated: (params) => params.speed !== 0,
  params: [
    { kind: 'float', key: 'speed', label: 'Speed', min: -2, max: 2, step: 0.005, default: 0.1 },
    { kind: 'float', key: 'offset', label: 'Offset', min: 0, max: 1, step: 0.005, default: 0 },
    { kind: 'float', key: 'seam', label: 'Seam Width', min: 0, max: 0.2, step: 0.002, default: 0.02 },
    { kind: 'float', key: 'darkness', label: 'Seam Darkness', min: 0, max: 1, step: 0.01, default: 0.8 },
  ],
  fragment: `  float y = fract(v_uv.y + u_time * u_speed + u_offset);
  vec4 c = texture(u_src, vec2(v_uv.x, y));

  // The seam sits where the wrap happens, so it travels with the picture.
  float seam = 1.0 - smoothstep(0.0, max(u_seam, 0.0001), y);
  fragColor = vec4(c.rgb * (1.0 - seam * u_darkness), c.a);`,
};
