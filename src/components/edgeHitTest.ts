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

/** How close, in graph units, a node has to get before a link will take it. */
const INSERT_DISTANCE = 46;

/** Enough samples to follow a curve; the paths here are short and simple. */
const SAMPLES = 24;

export const findEdgeUnderPoint = (
  centerX: number,
  centerY: number,
  exclude: Set<string>,
): string | null => {
  let closest: string | null = null;
  let closestDistance = INSERT_DISTANCE;

  for (const group of document.querySelectorAll<SVGGElement>('.react-flow__edge')) {
    const edgeId = group.getAttribute('data-id');
    // The node's own wires are always underneath it; they are not candidates.
    if (!edgeId || exclude.has(edgeId)) continue;

    const path = group.querySelector<SVGPathElement>('path.react-flow__edge-path');
    if (!path) continue;

    const length = path.getTotalLength();
    if (length === 0) continue;

    for (let i = 0; i <= SAMPLES; i += 1) {
      const point = path.getPointAtLength((length * i) / SAMPLES);
      const distance = Math.hypot(point.x - centerX, point.y - centerY);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = edgeId;
      }
    }
  }

  return closest;
};
