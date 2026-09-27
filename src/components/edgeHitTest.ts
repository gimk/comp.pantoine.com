/**
 * Finds the link a dragged node is hovering over, so it can be dropped into
 * the flow rather than just parked on top of the wire.
 *
 * The links are beziers, so there is no formula worth writing here: the
 * rendered path is sampled and measured directly. Those samples come back in
 * the graph's own coordinate space -- React Flow pans and zooms by putting a
 * CSS transform on the viewport around the SVG, so the path data itself is
 * untransformed. Comparing against the node's flow position therefore needs
 * no matrix, and the threshold stays constant relative to the graph however
 * far the user has zoomed out.
 */

export type NodeBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type EdgePathCandidate = {
  id: string;
  getTotalLength: () => number;
  getPointAtLength: (distance: number) => { x: number; y: number };
};

/**
 * Shortest distance from a point to an axis-aligned box.
 * Returns 0 if the point is inside the box.
 */
export const distanceToBox = (
  px: number,
  py: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): number => {
  const dx = Math.max(rx - px, 0, px - (rx + rw));
  const dy = Math.max(ry - py, 0, py - (ry + rh));
  return Math.hypot(dx, dy);
};

/** How close, in graph units, a wire has to get to the node boundary before it offers to insert. */
const INSERT_TOLERANCE = 14;

/**
 * Permissive edge detection over path candidates: as soon as a wire crosses
 * or touches anywhere within the dragged node's bounding rectangle (plus a small
 * tolerance margin), it qualifies for splicing. If multiple wires cross the
 * module, the one passing closest to the module's centre wins.
 */
export const findEdgeUnderNodeWithElements = (
  box: NodeBox,
  candidates: EdgePathCandidate[],
  exclude: Set<string>,
): string | null => {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  let bestEdge: string | null = null;
  let bestCenterDistance = Infinity;

  for (const edge of candidates) {
    if (exclude.has(edge.id)) continue;

    const length = edge.getTotalLength();
    if (length === 0) continue;

    const sampleCount = Math.max(24, Math.ceil(length / 14));
    let crossesNode = false;
    let minCenterDist = Infinity;

    for (let i = 0; i <= sampleCount; i += 1) {
      const point = edge.getPointAtLength((length * i) / sampleCount);
      const boxDist = distanceToBox(point.x, point.y, box.x, box.y, box.width, box.height);
      if (boxDist <= INSERT_TOLERANCE) {
        crossesNode = true;
      }
      const centerDist = Math.hypot(point.x - centerX, point.y - centerY);
      if (centerDist < minCenterDist) {
        minCenterDist = centerDist;
      }
    }

    if (crossesNode && minCenterDist < bestCenterDistance) {
      bestCenterDistance = minCenterDist;
      bestEdge = edge.id;
    }
  }

  return bestEdge;
};

/**
 * Finds the edge under the dragged node by inspecting SVG edge paths in the DOM.
 */
export const findEdgeUnderNode = (
  box: NodeBox,
  exclude: Set<string>,
): string | null => {
  if (typeof document === 'undefined') return null;

  const candidates: EdgePathCandidate[] = [];
  for (const group of document.querySelectorAll<SVGGElement>('.react-flow__edge')) {
    const edgeId = group.getAttribute('data-id');
    if (!edgeId || exclude.has(edgeId)) continue;

    const path = group.querySelector<SVGPathElement>('path.react-flow__edge-path');
    if (!path) continue;

    candidates.push({
      id: edgeId,
      getTotalLength: () => path.getTotalLength(),
      getPointAtLength: (d) => path.getPointAtLength(d),
    });
  }

  return findEdgeUnderNodeWithElements(box, candidates, exclude);
};

/** Backward-compatible helper testing proximity to a single point. */
export const findEdgeUnderPoint = (
  centerX: number,
  centerY: number,
  exclude: Set<string>,
): string | null =>
  findEdgeUnderNode({ x: centerX - 24, y: centerY - 24, width: 48, height: 48 }, exclude);
