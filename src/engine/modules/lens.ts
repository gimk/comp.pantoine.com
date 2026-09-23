import type { EffectDef } from '../effects';

/**
 * Radial lens distortion -- the glass bulge of a CRT tube, or a fisheye.
 *
 * Curvature is bipolar: positive magnifies the centre and pushes content
 * off the edges (barrel, what a tube face does), negative pulls it in
 * (pincushion). Zoom is the companion knob, because barrel distortion
 * leaves the corners sampling from outside the image and zooming back in is
 * how you crop that away rather than living with a smeared border.
 *
 * Not `mixable`: crossfading a warped image against its unwarped self is a
 * double exposure, not a weaker warp. Curvature already is the strength.
 */
export const lens: EffectDef = {
  id: 'lens',
  label: 'Lens',
  category: 'optics',
  animated: false,
  params: [
    { kind: 'float', key: 'curvature', label: 'Curvature', min: -1, max: 1, step: 0.01, default: 0.2 },
    { kind: 'float', key: 'zoom', label: 'Zoom', min: 0.5, max: 2, step: 0.01, default: 1 },
    { kind: 'enum', key: 'edge', label: 'Edge', options: ['Clamp', 'Wrap', 'Black', 'Mirror'], default: 2 },
  ],
  fragment: `  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (v_uv - 0.5) * vec2(aspect, 1.0);
  // Single even-powered radial term: the r^2 of a Brown-Conrady model,
  // which is all a screen-shaped curve needs.
  p *= 1.0 + u_curvature * dot(p, p);
  p /= max(u_zoom, 0.01);
  fragColor = sampleEdge(u_src, p / vec2(aspect, 1.0) + 0.5, u_edge);`,
};
