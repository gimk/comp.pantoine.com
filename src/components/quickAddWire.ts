import type { Handle, ReactFlowState } from '@xyflow/react';
import { isValidConnection } from '../state/connections';
import { MOD_OUTPUT, isParamPort } from '../state/graph';
import { isGroup, realWire } from '../state/groups';
import { useGraph } from '../state/store';

/** How many frames to wait for a new card to render its ports before giving up. */
const MAX_FRAMES = 30;

/**
 * Plug a module just added from the add menu into the wire that was being
 * dragged when the menu opened -- Blender's link-drag search, more or less.
 *
 * `before` is every node id from just before the add, which is how the new
 * module is found: a preset lands as a group plus its members, and the group's
 * card is the one to wire. Its ports only exist once the card has rendered and
 * React Flow has measured it, so this waits for that.
 *
 * Dragged out of an output, the wire goes into the first input on the new
 * module that will take it; dragged out of an input, from its first output
 * that fits. A signal prefers a param port, and a picture a picture port,
 * whichever end it came from. Dragged from an input, the module also moves
 * left of the pointer, so it sits upstream of what it feeds.
 */
export const wireNewModule = (getFlow: () => ReactFlowState, before: Set<string>, from: Handle): void => {
  const added = useGraph.getState().nodes.filter((node) => !before.has(node.id));
  const node = added.find(isGroup) ?? (added.length === 1 ? added[0] : undefined);
  if (!node) return;

  let frames = 0;
  const attempt = () => {
    const bounds = getFlow().nodeLookup.get(node.id)?.internals.handleBounds;
    const width = getFlow().nodeLookup.get(node.id)?.measured.width;
    if (!bounds || !width) {
      if (++frames < MAX_FRAMES) requestAnimationFrame(attempt);
      return;
    }
    const { nodes, edges, onConnect } = useGraph.getState();

    const intoNew = from.type === 'source';
    const signal = intoNew
      ? from.id === MOD_OUTPUT || nodes.find((n) => n.id === from.nodeId)?.type === 'modulator'
      : isParamPort(from.id);
    const isSignalPort = (handle: Handle) => (intoNew ? isParamPort(handle.id) : handle.id === MOD_OUTPUT);
    const ports = (intoNew ? bounds.target : bounds.source) ?? [];
    // Stable, so each kind keeps the order the card draws them in.
    const ordered = [...ports].sort((a, b) => Number(isSignalPort(b) === signal) - Number(isSignalPort(a) === signal));

    const wires = ordered.map((port) =>
      intoNew
        ? { source: from.nodeId, sourceHandle: from.id ?? null, target: node.id, targetHandle: port.id ?? null }
        : { source: node.id, sourceHandle: port.id ?? null, target: from.nodeId, targetHandle: from.id ?? null },
    );
    const wire = wires.find((candidate) => isValidConnection(nodes, edges, realWire(nodes, candidate)));

    // A group card is moved with its members, which the store does on a drag; left where it is.
    if (!intoNew && !isGroup(node)) {
      useGraph.setState({
        nodes: nodes.map((n) => (n.id === node.id ? { ...n, position: { ...n.position, x: n.position.x - width } } : n)),
      });
    }
    if (wire) onConnect(wire);
  };
  requestAnimationFrame(attempt);
};
