import React, { useCallback, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type OnNodeDrag,
} from '@xyflow/react';
import { findEdgeUnderPoint } from './components/edgeHitTest';
import { LinkEdge } from './components/LinkEdge';
import {
  PALETTE_DRAG_MIME,
  decodePaletteItem,
  paletteDropOffset,
} from './components/paletteDrag';
import type { AppNode } from './state/graph';
import { ImageNode } from './components/ImageNode';
import { EffectNode } from './components/EffectNode';
import { OutputNode } from './components/OutputNode';
import { Toolbar } from './components/Toolbar';
import { useGraph } from './state/store';
import '@xyflow/react/dist/style.css';
import './styles/glass.css';

/**
 * Declared outside the component so React Flow sees a stable identity.
 *
 * The sink is `renderOutput` rather than `output` on purpose: React Flow
 * ships built-in `input`/`output`/`default` node types, and reusing the name
 * pulls in their stylesheet, which paints a white card behind the glass one.
 */
const nodeTypes = {
  image: ImageNode,
  effect: EffectNode,
  renderOutput: OutputNode,
};

/**
 * Every wire is a `LinkEdge` -- the built-in bezier plus a hit band and a
 * remove button. Stable identity for the same reason as `nodeTypes`.
 */
const edgeTypes = {
  link: LinkEdge,
};

const defaultEdgeOptions = {
  type: 'link',
  animated: false,
};

/* Even padding now that nothing overlays the graph but the toolbar. */
const fitViewOptions = {
  padding: { top: '72px', right: '40px', bottom: '40px', left: '40px' },
} as const;

const Editor: React.FC = () => {
  const nodes = useGraph((state) => state.nodes);
  const edges = useGraph((state) => state.edges);
  const onNodesChange = useGraph((state) => state.onNodesChange);
  const onEdgesChange = useGraph((state) => state.onEdgesChange);
  const onConnect = useGraph((state) => state.onConnect);
  const insertTargetEdgeId = useGraph((state) => state.insertTargetEdgeId);

  /*
   * Dragging an effect over a link offers to splice it into the flow. The
   * candidate link is highlighted while the node is held over it, so the
   * drop is never a guess.
   */
  const handleNodeDrag: OnNodeDrag<AppNode> = useCallback((_event, node) => {
    const { edges: current, setInsertTarget } = useGraph.getState();
    if (node.type !== 'effect') {
      setInsertTarget(null);
      return;
    }
    const own = new Set(
      current
        .filter((edge) => edge.source === node.id || edge.target === node.id)
        .map((edge) => edge.id),
    );
    const centerX = node.position.x + (node.measured?.width ?? 0) / 2;
    const centerY = node.position.y + (node.measured?.height ?? 0) / 2;
    setInsertTarget(findEdgeUnderPoint(centerX, centerY, own));
  }, []);

  const handleNodeDragStop: OnNodeDrag<AppNode> = useCallback((_event, node) => {
    const { insertTargetEdgeId: target, insertNodeOnEdge, setInsertTarget } = useGraph.getState();
    if (target) insertNodeOnEdge(node.id, target);
    else setInsertTarget(null);
  }, []);

  const { screenToFlowPosition } = useReactFlow();

  /*
   * An item dragged in from the palette.
   *
   * `dragover` may only inspect the payload's types, not read it -- the
   * browser withholds the data until the drop -- so the check that this is
   * one of ours and not a file or a link from another tab has to be made
   * against `types` here, and against the value itself on drop.
   */
  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(PALETTE_DRAG_MIME)) return;
    // Omitting this leaves the default handler in place, which refuses
    // every drop; the canvas would simply never accept one.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      const item = decodePaletteItem(event.dataTransfer.getData(PALETTE_DRAG_MIME));
      if (!item) return;
      event.preventDefault();

      // The pointer is in screen pixels; the graph has its own pan and zoom.
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const offset = paletteDropOffset(item);
      const position = { x: point.x - offset.x, y: point.y - offset.y };

      const store = useGraph.getState();
      if (item.kind === 'effect') store.addEffectNode(item.effectId, position);
      else if (item.kind === 'image') store.addImageNode(position);
      else store.addOutputNode(position);
    },
    [screenToFlowPosition],
  );

  /*
   * Moving a wire. React Flow reports the drop and the outcome separately,
   * so this records whether the end actually landed on a port.
   */
  const reconnected = useRef(false);

  const handleReconnectStart = useCallback(() => {
    reconnected.current = false;
  }, []);

  const handleReconnect = useCallback((oldEdge: Edge, connection: Connection) => {
    reconnected.current = true;
    useGraph.getState().reconnectLink(oldEdge, connection);
  }, []);

  /*
   * Dropping an end on bare canvas removes the wire. It is the gesture node
   * editors have trained people to expect, and it makes unplugging exactly
   * as direct as plugging in -- drag it off and it is gone.
   */
  const handleReconnectEnd = useCallback((_event: MouseEvent | TouchEvent, edge: Edge) => {
    if (!reconnected.current) useGraph.getState().removeEdge(edge.id);
  }, []);

  const edgesForFlow = useMemo(() => {
    if (!insertTargetEdgeId) return edges;
    return edges.map((edge) =>
      edge.id === insertTargetEdgeId ? { ...edge, className: 'edge-insert-target' } : edge,
    );
  }, [edges, insertTargetEdgeId]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edgesForFlow}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeDrag={handleNodeDrag}
      onNodeDragStop={handleNodeDragStop}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onReconnect={handleReconnect}
      onReconnectStart={handleReconnectStart}
      onReconnectEnd={handleReconnectEnd}
      edgesReconnectable
      // Generous, because the grab target is a wire end rather than a port.
      reconnectRadius={26}
      // Delete is what most people reach for; Backspace is the library's own.
      deleteKeyCode={['Backspace', 'Delete']}
      minZoom={0.3}
      maxZoom={2}
      fitView
      fitViewOptions={fitViewOptions}
    >
      <Background variant={BackgroundVariant.Dots} gap={26} size={1.4} color="rgba(23,23,26,0.16)" />
    </ReactFlow>
  );
};

export const App: React.FC = () => (
  <div className="app">
    <ReactFlowProvider>
      <main className="canvas-area">
        <Editor />
      </main>
      <Toolbar />
    </ReactFlowProvider>
  </div>
);
