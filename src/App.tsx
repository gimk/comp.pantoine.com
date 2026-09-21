import React, { useCallback, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  type OnNodeDrag,
} from '@xyflow/react';
import { findEdgeUnderPoint } from './components/edgeHitTest';
import type { AppNode } from './state/graph';
import { ImageNode } from './components/ImageNode';
import { EffectNode } from './components/EffectNode';
import { OutputNode } from './components/OutputNode';
import { RenderView } from './components/RenderView';
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

/** React Flow's `default` edge is the bezier one -- curved, not stepped. */
const defaultEdgeOptions = {
  type: 'default',
  animated: false,
};

/*
 * The graph runs full bleed under the render view, so fitView is told to
 * keep clear of it by hand. These mirror `--render-width` and `--gutter`;
 * change one and change the other.
 */
const fitViewOptions = {
  padding: { top: '40px', right: '440px', bottom: '40px', left: '40px' },
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
      defaultEdgeOptions={defaultEdgeOptions}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeDrag={handleNodeDrag}
      onNodeDragStop={handleNodeDragStop}
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
      <RenderView />
    </ReactFlowProvider>
  </div>
);
