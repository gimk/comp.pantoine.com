import type { XYPosition } from '@xyflow/react';
import type { AppNode } from './graph';

/** How close, in graph units, a line has to come before it snaps. */
const SNAP_DISTANCE = 10;

/**
 * How far, in graph units, a module can sit from the dragged nodes and still
 * be snapped to. Measured as the gap between the two boxes, so a wide module
 * next door counts as near however far away its centre is.
 */
const SNAP_ZONE = 560;

/** A line the dragged nodes snapped to, drawn only as far as it spans. */
export type SnapGuide =
  | { axis: 'horizontal'; y: number; from: number; to: number }
  | { axis: 'vertical'; x: number; from: number; to: number };

export type Box = { left: number; top: number; right: number; bottom: number };

const boxOf = (node: AppNode, position: XYPosition): Box | null => {
  const width = node.measured?.width;
  const height = node.measured?.height;
  if (!width || !height) return null;
  return { left: position.x, top: position.y, right: position.x + width, bottom: position.y + height };
};

/*
 * What lines up with what: centres only, on both axes. A row of modules
 * runs through their middles whatever their heights, and a column stacks
 * on a shared centre line.
 */
const rowLines = (box: Box): number[] => [(box.top + box.bottom) / 2];
const columnLines = (box: Box): number[] => [(box.left + box.right) / 2];

const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Whether two boxes are within the snap zone of each other, on both axes. */
const withinZone = (a: Box, b: Box): boolean => {
  const gapX = Math.max(0, b.left - a.right, a.left - b.right);
  const gapY = Math.max(0, b.top - a.bottom, a.top - b.bottom);
  return gapX <= SNAP_ZONE && gapY <= SNAP_ZONE;
};

/** The smallest correction that lands one of `moving` on one of `fixed`. */
const nearest = (moving: number[], fixed: number[]): { shift: number; at: number } | null => {
  let best: { shift: number; at: number } | null = null;
  for (const m of moving) {
    for (const f of fixed) {
      const shift = f - m;
      if (Math.abs(shift) > SNAP_DISTANCE) continue;
      if (!best || Math.abs(shift) < Math.abs(best.shift)) best = { shift, at: f };
    }
  }
  return best;
};

/**
 * Snap a drag in progress against the modules around it.
 *
 * Only modules that are on screen and within the snap zone of the dragged
 * nodes count. Anything further off would pull the drag onto a line the
 * user cannot see the other end of -- with a large graph, nearly every
 * position is within snapping distance of *some* distant centre, and the
 * drag would never move freely at all.
 *
 * The dragged nodes are treated as one box, since they all move by the same
 * delta: aligning each separately would pull a group apart. Returns the
 * correction to add to every dragged position, and the guides to draw.
 */
export const snapDrag = (
  nodes: AppNode[],
  origins: Map<string, XYPosition>,
  delta: XYPosition,
  visible: Box | null,
): { shift: XYPosition; guides: SnapGuide[] } => {
  let group: Box | null = null;
  const others: Box[] = [];

  for (const node of nodes) {
    const origin = origins.get(node.id);
    const box = origin
      ? boxOf(node, { x: origin.x + delta.x, y: origin.y + delta.y })
      : boxOf(node, node.position);
    if (!box) continue;
    if (!origin) {
      others.push(box);
      continue;
    }
    group = group
      ? {
          left: Math.min(group.left, box.left),
          top: Math.min(group.top, box.top),
          right: Math.max(group.right, box.right),
          bottom: Math.max(group.bottom, box.bottom),
        }
      : box;
  }

  const dragged = group;
  const near = dragged
    ? others.filter((box) => withinZone(box, dragged) && (!visible || overlaps(box, visible)))
    : [];
  if (!group || near.length === 0) return { shift: { x: 0, y: 0 }, guides: [] };

  const row = nearest(rowLines(group), near.flatMap(rowLines));
  const column = nearest(columnLines(group), near.flatMap(columnLines));
  const shift = { x: column?.shift ?? 0, y: row?.shift ?? 0 };

  // Each guide runs from the dragged box to the farthest node sharing the
  // line, so it reads as "these line up" rather than as a ruler to nowhere.
  const guides: SnapGuide[] = [];
  const snapped = {
    left: group.left + shift.x,
    top: group.top + shift.y,
    right: group.right + shift.x,
    bottom: group.bottom + shift.y,
  };
  if (row) {
    const touching = near.filter((box) => rowLines(box).some((y) => Math.abs(y - row.at) < 0.5));
    guides.push({
      axis: 'horizontal',
      y: row.at,
      from: Math.min(snapped.left, ...touching.map((box) => box.left)),
      to: Math.max(snapped.right, ...touching.map((box) => box.right)),
    });
  }
  if (column) {
    const touching = near.filter((box) => columnLines(box).some((x) => Math.abs(x - column.at) < 0.5));
    guides.push({
      axis: 'vertical',
      x: column.at,
      from: Math.min(snapped.top, ...touching.map((box) => box.top)),
      to: Math.max(snapped.bottom, ...touching.map((box) => box.bottom)),
    });
  }

  return { shift, guides };
};
