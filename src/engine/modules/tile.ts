import type { EffectDef } from '../effects';

/**
 * The picture repeated in a grid: Count X across and Count Y down, each
 * tile the whole picture.
 *
 * Brick Offset shifts each row along by that fraction of a tile, as a
 * brick wall's courses are. Mirror flips every other column or row so
 * neighbouring tiles meet edge to matching edge -- a seamless pattern from
 * any picture. Rotation turns the grid as a whole, about the frame's
 * centre and in square units, so the tiles stay rectangles.
 */
export const tile: EffectDef = {
  id: 'tile',
  label: 'Tile',
  category: 'geometry',
  animated: false,
  mixable: true,
  params: [
    { kind: 'int', key: 'countX', label: 'Count X', min: 1, max: 32, default: 3 },
    { kind: 'int', key: 'countY', label: 'Count Y', min: 1, max: 32, default: 3 },
    { kind: 'float', key: 'brick', label: 'Brick Offset', min: 0, max: 1, step: 0.01, default: 0 },
    { kind: 'bool', key: 'mirrorX', label: 'Mirror X', default: false },
    { kind: 'bool', key: 'mirrorY', label: 'Mirror Y', default: false },
    { kind: 'float', key: 'rotation', label: 'Rotation (°)', min: -180, max: 180, step: 1, default: 0 },
  ],
  fragment: `  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (v_uv - 0.5) * vec2(aspect, 1.0);
  float a = radians(u_rotation);
  p = vec2(cos(a) * p.x + sin(a) * p.y, -sin(a) * p.x + cos(a) * p.y);
  p = p / vec2(aspect, 1.0) + 0.5;

  vec2 grid = p * vec2(float(max(u_countX, 1)), float(max(u_countY, 1)));
  float row = floor(grid.y);
  grid.x += row * u_brick;
  vec2 cell = floor(grid);
  vec2 f = grid - cell;
  if (u_mirrorX && mod(cell.x, 2.0) > 0.5) f.x = 1.0 - f.x;
  if (u_mirrorY && mod(cell.y, 2.0) > 0.5) f.y = 1.0 - f.y;
  fragColor = texture(u_src, f);`,
};
