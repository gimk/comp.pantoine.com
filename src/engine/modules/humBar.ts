import type { EffectDef } from '../effects';

/**
 * A soft brightness band drifting up the picture -- mains hum beating
 * against the frame rate.
 *
 * Intensity is bipolar because both exist: a dark bar is interference in
 * the signal, a bright one is interference in the supply.
 *
 * The band is measured on a wrapped coordinate, so it leaves the top and
 * re-enters at the bottom in one continuous move with no jump at the seam.
 */
export const humBar: EffectDef = {
  id: 'humBar',
  label: 'Hum Bar',
  category: 'tape',
  animated: (params) => params.speed !== 0,
  params: [
    { kind: 'float', key: 'width', label: 'Width', min: 0.01, max: 0.5, step: 0.005, default: 0.15 },
    { kind: 'float', key: 'speed', label: 'Speed', min: -1, max: 1, step: 0.005, default: 0.06 },
    { kind: 'float', key: 'intensity', label: 'Intensity', min: -1, max: 1, step: 0.01, default: 0.2 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  float phase = fract(v_uv.y - u_time * u_speed);

  // Distance to the band centre, measured the short way round the wrap so
  // the band does not tear in half as it crosses the edge.
  float d = abs(phase - 0.5);
  float band = 1.0 - smoothstep(0.0, max(u_width, 0.001), d);

  fragColor = vec4(src.rgb * (1.0 + band * u_intensity), src.a);`,
};
