import type { EffectDef, Vec2 } from '../effects';

/**
 * Pins the picture's four corners anywhere, warping it in true
 * perspective -- onto a screen, a sign, the side of a building.
 *
 * The square-to-quad homography after Heckbert: eight numbers, solved in
 * closed form from the four corners, that take the picture's square to the
 * pinned quad. Each output pixel is taken back through its inverse to find
 * where in the picture it came from. A projective map, not a bilinear one,
 * so straight lines stay straight and the far side of a plane is really
 * foreshortened.
 *
 * Corners are in the frame's own coordinates, (0, 0) at the bottom left
 * as everywhere in the engine, and default to the frame's corners: the
 * identity. Outside the quad is transparent, black, or the picture as it
 * was underneath.
 */

/** The homography's eight numbers: x = (a u + b v + c) / (g u + h v + 1), y likewise with d e f. */
export type Homography = [number, number, number, number, number, number, number, number];

/** The map taking the unit square to the quad bottom-left, bottom-right, top-right, top-left. */
export const squareToQuad = (bl: Vec2, br: Vec2, tr: Vec2, tl: Vec2): Homography => {
  const [x0, y0] = bl;
  const [x1, y1] = br;
  const [x2, y2] = tr;
  const [x3, y3] = tl;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const safe = Math.abs(det) < 1e-9 ? 1e-9 : det;
  const g = (dx3 * dy2 - dx2 * dy3) / safe;
  const h = (dx1 * dy3 - dx3 * dy1) / safe;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
};

export const applyHomography = ([a, b, c, d, e, f, g, h]: Homography, [u, v]: Vec2): Vec2 => {
  const w = g * u + h * v + 1;
  return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
};

/** The inverse map, quad to unit square, as the shader does it: through the 3×3 inverse. */
export const quadToSquare = ([a, b, c, d, e, f, g, h]: Homography, [x, y]: Vec2): Vec2 => {
  // Adjugate of [[a b c] [d e f] [g h 1]]; the determinant cancels in the divide.
  const i00 = e - f * h;
  const i01 = c * h - b;
  const i02 = b * f - c * e;
  const i10 = f * g - d;
  const i11 = a - c * g;
  const i12 = c * d - a * f;
  const i20 = d * h - e * g;
  const i21 = b * g - a * h;
  const i22 = a * e - b * d;
  const w = i20 * x + i21 * y + i22;
  return [(i00 * x + i01 * y + i02) / w, (i10 * x + i11 * y + i12) / w];
};

export const cornerPin: EffectDef = {
  id: 'cornerPin',
  label: 'Corner Pin',
  category: 'geometry',
  animated: false,
  mixable: true,
  params: [
    { kind: 'vec2', key: 'topLeft', label: 'Top Left', min: -0.5, max: 1.5, step: 0.005, default: [0, 1] },
    { kind: 'vec2', key: 'topRight', label: 'Top Right', min: -0.5, max: 1.5, step: 0.005, default: [1, 1] },
    { kind: 'vec2', key: 'bottomRight', label: 'Bottom Right', min: -0.5, max: 1.5, step: 0.005, default: [1, 0] },
    { kind: 'vec2', key: 'bottomLeft', label: 'Bottom Left', min: -0.5, max: 1.5, step: 0.005, default: [0, 0] },
    { kind: 'enum', key: 'outside', label: 'Outside', options: ['Transparent', 'Black', 'Source'], default: 0 },
  ],
  fragment: `  vec2 q0 = u_bottomLeft;
  vec2 q1 = u_bottomRight;
  vec2 q2 = u_topRight;
  vec2 q3 = u_topLeft;
  vec2 d1 = q1 - q2;
  vec2 d2 = q3 - q2;
  vec2 d3 = q0 - q1 + q2 - q3;
  float det = d1.x * d2.y - d2.x * d1.y;
  if (abs(det) < 1e-9) det = 1e-9;
  float g = (d3.x * d2.y - d2.x * d3.y) / det;
  float h = (d1.x * d3.y - d3.x * d1.y) / det;
  // Columns: the u, v and constant terms.
  mat3 toQuad = mat3(
    q1.x - q0.x + g * q1.x, q1.y - q0.y + g * q1.y, g,
    q3.x - q0.x + h * q3.x, q3.y - q0.y + h * q3.y, h,
    q0.x, q0.y, 1.0
  );
  vec3 s = inverse(toQuad) * vec3(v_uv, 1.0);
  vec2 uv = s.xy / s.z;

  bool inside = s.z > 0.0 && uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
  if (inside) fragColor = texture(u_src, uv);
  else if (u_outside == 0) fragColor = vec4(0.0);
  else if (u_outside == 1) fragColor = vec4(0.0, 0.0, 0.0, 1.0);
  else fragColor = texture(u_src, v_uv);`,
};
