import React from 'react';
import { ViewportPortal, getBezierPath, type Position, type XYPosition } from '@xyflow/react';

/** Where a wire held when the add menu opened runs, in graph units. */
export type PendingWireShape = {
  from: XYPosition;
  fromPosition: Position;
  to: XYPosition;
  toPosition: Position;
};

/**
 * The wire that was being dragged when the add menu opened, pinned from its
 * port to the menu. React Flow drops its own line the moment the button is
 * let go; this one stays until a module is picked or the menu closes, so it
 * is clear where the pick will be plugged in.
 *
 * Drawn the way React Flow draws a live connection, and with its class, so
 * the two look the same.
 */
export const PendingWire: React.FC<{ wire: PendingWireShape }> = ({ wire }) => {
  const [path] = getBezierPath({
    sourceX: wire.from.x,
    sourceY: wire.from.y,
    sourcePosition: wire.fromPosition,
    targetX: wire.to.x,
    targetY: wire.to.y,
    targetPosition: wire.toPosition,
  });
  return (
    <ViewportPortal>
      <svg className="pending-wire" aria-hidden>
        <path className="react-flow__connection-path" d={path} fill="none" />
      </svg>
    </ViewportPortal>
  );
};
