import React, { useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { X } from 'lucide-react';
import { useGraph } from '../state/store';
import { findUpstreamRenderNode, isParamPort, isRenderPort } from '../state/graph';

/**
 * A wire, with the two things you need to do to one close at hand.
 *
 * The drawn line is 1.6px of ink, which is far too thin to ask anyone to
 * hit. A transparent band is laid over the same path to catch the pointer,
 * so hovering a link is a matter of getting near it rather than on it.
 *
 * Removing shows on hover and on selection both: hover is the fast path
 * once you know the button is there, and selection is what makes it
 * reachable by keyboard and what keeps it on screen while the pointer
 * travels to it.
 */
export const LinkEdge: React.FC<EdgeProps> = ({
  id,
  source,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  selected,
  markerEnd,
  style,
  sourceHandleId,
  targetHandleId,
}) => {
  const nodes = useGraph((state) => state.nodes);
  const edges = useGraph((state) => state.edges);
  const removeEdge = useGraph((state) => state.removeEdge);
  const [hovered, setHovered] = useState(false);

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isRender =
    isRenderPort(targetHandleId) ||
    isRenderPort(sourceHandleId) ||
    (() => {
      const srcNode = nodes.find((n) => n.id === source);
      if (srcNode?.type === 'render' || srcNode?.type === 'formatter') return true;
      if (srcNode?.type === 'renderOutput') return !!findUpstreamRenderNode(nodes, edges, srcNode.id);
      return false;
    })();

  const isMod = isParamPort(targetHandleId);

  return (
    <>
      {/* High-contrast halo underlay: guarantees crisp visibility over black, dark pictures, and light ground */}
      <path
        d={path}
        className={`link-edge-halo ${
          isRender
            ? 'link-edge-halo-render'
            : isMod
              ? 'link-edge-halo-mod'
              : ''
        }`}
        aria-hidden="true"
      />

      {/* Purple for rendered media asset, dashed for modulation signal, solid ink for picture */}
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        className={
          isRender
            ? 'link-edge-render'
            : isMod
              ? 'link-edge-mod'
              : undefined
        }
      />

      <path
        d={path}
        className="link-edge-hit"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      />

      <EdgeLabelRenderer>
        {(hovered || selected) && (
          <button
            type="button"
            /* nodrag/nopan or the click would pan the canvas underneath. */
            className="link-edge-remove nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onClick={(event) => {
              // Without this the click also lands on the canvas and clears
              // the selection before the removal is seen.
              event.stopPropagation();
              removeEdge(id);
            }}
            title="Remove link"
            aria-label="Remove link"
          >
            <X size={11} />
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  );
};
