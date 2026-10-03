import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  useStoreApi,
  PanOnScrollMode,
  SelectionMode,
  type Connection,
  type Edge,
  type Handle,
  type OnNodeDrag,
} from '@xyflow/react';
import { findEdgeUnderNode } from './components/edgeHitTest';
import { LinkEdge } from './components/LinkEdge';
import {
  PALETTE_DRAG_MIME,
  decodePaletteItem,
  paletteDropOffset,
} from './components/paletteDrag';
import { addMediaFiles, addPaletteItem } from './components/paletteCatalog';
import { QuickAdd } from './components/QuickAdd';
import { PendingWire, type PendingWireShape } from './components/PendingWire';
import { useShallow } from 'zustand/react/shallow';
import type { AppNode } from './state/graph';
import { isValidConnection as isConnectionAllowed } from './state/connections';
import { chainEnds, drawnEdges, isGroup, realWire } from './state/groups';
import { GroupNode } from './components/GroupNode';
import { withNodeBoundary } from './components/NodeBoundary';
import { ImageNode } from './components/ImageNode';
import { VideoNode } from './components/VideoNode';
import { GeneratorNode } from './components/GeneratorNode';
import { EffectNode } from './components/EffectNode';
import { ModulatorNode } from './components/ModulatorNode';
import { OutputNode } from './components/OutputNode';
import { BackgroundNode } from './components/BackgroundNode';
import { FullScreenBackground, activeBackground } from './components/FullScreenBackground';
import { RenderNode } from './components/RenderNode';
import { ExportNode } from './components/ExportNode';
import { SnapGuides } from './components/SnapGuides';
import { Toolbar } from './components/Toolbar';
import { Transport } from './components/Transport';
import { HintBar } from './components/HintBar';
import { AboutModal } from './components/AboutModal';
import { PresetModal } from './components/PresetModal';
import { WelcomeModal } from './components/WelcomeModal';
import { useCanvasShortcuts } from './components/useCanvasShortcuts';
import { canSpliceInto, dragMode, setDragModifiers, setVisibleAreaSource, useGraph } from './state/store';
import { commitNow } from './state/history';
import { autosaveBlocked } from './state/document';
import '@xyflow/react/dist/style.css';
import './styles/glass.css';

/**
 * Declared outside the component so React Flow sees a stable identity.
 *
 * The sink is `renderOutput` rather than `output` on purpose: React Flow
 * ships built-in `input`/`output`/`default` node types, and reusing the name
 * pulls in their stylesheet, which paints a white card behind the glass one.
 * A group is `moduleGroup` for the same reason: `group` is built in too.
 *
 * Each is wrapped in its own error boundary, so one card that throws shows
 * as broken on its own instead of taking the whole canvas with it.
 */
const nodeTypes = {
  image: withNodeBoundary(ImageNode),
  video: withNodeBoundary(VideoNode),
  generator: withNodeBoundary(GeneratorNode),
  effect: withNodeBoundary(EffectNode),
  modulator: withNodeBoundary(ModulatorNode),
  renderOutput: withNodeBoundary(OutputNode),
  backgroundOutput: withNodeBoundary(BackgroundNode),
  render: withNodeBoundary(RenderNode),
  export: withNodeBoundary(ExportNode),
  moduleGroup: withNodeBoundary(GroupNode),
};

/**
 * Checked while the wire is still being dragged, so a port that would not
 * take it never lights up -- rather than accepting the drop and then
 * producing nothing, which would look like a bug in the effect. The rules
 * themselves live in `connections`, where the store and the loader share them.
 * A wire to a group's card is judged as the wire to the module inside it.
 */
const isValidConnection = (connection: Connection | Edge): boolean => {
  const { nodes, edges } = useGraph.getState();
  return isConnectionAllowed(nodes, edges, realWire(nodes, connection));
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

/* Even padding now that nothing overlays the graph but the toolbar. Capped at maxZoom: 1
   so small graphs are not magnified past 100%. */
const fitViewOptions = {
  padding: { top: '80px', right: '40px', bottom: '40px', left: '40px' },
  maxZoom: 1,
} as const;

/**
 * Figma-style hybrid navigation:
 * - Panning: middle click (1) or right click (2) drags to move around.
 * - Selection: left click (0) drag draws a selection box (selectionOnDrag).
 * - Zoom: Cmd or Ctrl + scroll wheel zooms in and out.
 * - Trackpad: two-finger scroll moves around freely (panOnScroll), pinch zooms.
 */
const panOnDrag = [1, 2];
const zoomActivationKeyCode = ['Meta', 'Control'];
const proOptions = { hideAttribution: true };

const Editor: React.FC = () => {
  const nodes = useGraph((state) => state.nodes);
  const edges = useGraph((state) => state.edges);
  const onNodesChange = useGraph((state) => state.onNodesChange);
  const onEdgesChange = useGraph((state) => state.onEdgesChange);
  const onConnect = useGraph((state) => state.onConnect);
  const insertTargetEdgeId = useGraph((state) => state.insertTargetEdgeId);
  // The dot grid is for bare canvas. Once a Background is drawing a picture
  // behind the graph, it only speckles over it.
  const backgroundShowing = useGraph((state) => {
    const node = activeBackground(state.nodes);
    return !!node && (node.data.opacity ?? 1) > 0 && state.edges.some((edge) => edge.target === node.id);
  });

  /*
   * Dragging an effect over a link offers to splice it into the flow. The
   * candidate link is highlighted while the node is held over it, so the
   * drop is never a guess.
   */
  const handleNodeDrag: OnNodeDrag<AppNode> = useCallback((_event, node) => {
    const { nodes: all, edges: current, setInsertTarget } = useGraph.getState();
    // A Ctrl-drag lifts modules out of the flow, the opposite of splicing
    // one in, so it never offers to.
    // A group goes in as the chain it holds, if it holds one.
    const insertable = node.type === 'effect' || (isGroup(node) && chainEnds(all, node) !== null);
    if (!insertable || dragMode() === 'detach') {
      setInsertTarget(null);
      return;
    }
    // The node's own wires are always underneath it -- a group's are its
    // members' -- and neither a modulation wire nor one carrying a baked
    // file has a live picture on it to put an effect into: the same test
    // the drop itself applies.
    const mine = new Set(isGroup(node) ? [node.id, ...node.data.members] : [node.id]);
    const own = new Set(
      current
        .filter((edge) => mine.has(edge.source) || mine.has(edge.target) || !canSpliceInto(all, current, edge))
        .map((edge) => edge.id),
    );
    const width = node.measured?.width ?? 196;
    const height = node.measured?.height ?? 120;
    const box = {
      x: node.position.x,
      y: node.position.y,
      width,
      height,
    };
    setInsertTarget(findEdgeUnderNode(box, own));
  }, []);

  const handleNodeDragStart: OnNodeDrag<AppNode> = useCallback((event, _node, dragged) => {
    const store = useGraph.getState();
    store.beginDrag(dragged);
    // Held from the start, or pressed later -- useCanvasShortcuts keeps
    // reporting them for as long as the drag lasts.
    setDragModifiers({ ctrl: event.ctrlKey, alt: event.altKey });
  }, []);

  const handleNodeDragStop: OnNodeDrag<AppNode> = useCallback((_event, node) => {
    const store = useGraph.getState();
    store.endDrag();
    // After an Alt-drag the node that landed is the copy, under a new id.
    const landed = store.endAltDuplicate()(node.id);
    const { insertTargetEdgeId: target, insertNodeOnEdge, setInsertTarget } = useGraph.getState();
    if (target) insertNodeOnEdge(landed, target);
    else setInsertTarget(null);
    commitNow();
  }, []);

  const { screenToFlowPosition, fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const hasInitialFitRef = useRef(false);

  // When all modules have initialized and measured their DOM geometry on load,
  // fit all modules into view cleanly with maxZoom: 1.
  useEffect(() => {
    if (nodesInitialized && !hasInitialFitRef.current) {
      hasInitialFitRef.current = true;
      requestAnimationFrame(() => {
        void fitView({
          ...fitViewOptions,
          maxZoom: 1,
          duration: 0,
        });
      });
    }
  }, [nodesInitialized, fitView]);

  const flowStore = useStoreApi();

  // Shift+A: where the add menu is open, in screen pixels, or null. Pressed
  // while a wire is being dragged, it also keeps the port the wire came
  // from, and the module picked is plugged into it. The wire itself stays
  // drawn, from its port to where the menu opened, until the menu closes.
  const [quickAdd, setQuickAdd] = useState<
    { x: number; y: number; from?: Handle; wire?: PendingWireShape } | null
  >(null);
  const closeQuickAdd = useCallback(() => setQuickAdd(null), []);
  const openQuickAdd = useCallback(
    (at: { x: number; y: number }) => {
      const { connection } = flowStore.getState();
      if (!connection.inProgress) {
        setQuickAdd(at);
        return;
      }
      setQuickAdd({
        ...at,
        from: connection.fromHandle,
        wire: {
          from: connection.from,
          fromPosition: connection.fromPosition,
          to: screenToFlowPosition(at),
          toPosition: connection.toPosition,
        },
      });
    },
    [flowStore, screenToFlowPosition],
  );
  useCanvasShortcuts(0.2, openQuickAdd);

  // Snapping only considers modules on screen; this is how it finds out
  // where the screen is, read fresh each time rather than kept in sync.
  useEffect(() => {
    setVisibleAreaSource(() => {
      const { width, height, transform } = flowStore.getState();
      const [x, y, zoom] = transform;
      if (!width || !height) return null;
      return { left: -x / zoom, top: -y / zoom, right: (width - x) / zoom, bottom: (height - y) / zoom };
    });
    return () => setVisibleAreaSource(() => null);
  }, [flowStore]);

  /*
   * An item dragged in from the palette, or files from the desktop.
   *
   * `dragover` may only inspect the payload's types, not read it -- the
   * browser withholds the data until the drop -- so the check that this is
   * one of ours or a file, and not a link from another tab, has to be made
   * against `types` here, and against the value itself on drop.
   */
  const handleDragOver = useCallback((event: React.DragEvent) => {
    const { types } = event.dataTransfer;
    if (!types.includes(PALETTE_DRAG_MIME) && !types.includes('Files')) return;
    // Omitting this leaves the default handler in place, which refuses
    // every drop; the canvas would simply never accept one.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      // An Image or Video card under the pointer has already taken the file.
      if (event.defaultPrevented) return;

      // The pointer is in screen pixels; the graph has its own pan and zoom.
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      const item = decodePaletteItem(event.dataTransfer.getData(PALETTE_DRAG_MIME));
      if (item) {
        event.preventDefault();
        const offset = paletteDropOffset(item);
        addPaletteItem(item, { x: point.x - offset.x, y: point.y - offset.y });
        return;
      }

      // Files from the desktop.
      const files = event.dataTransfer.files;
      if (files.length === 0) return;
      // Even when nothing in it is usable, so the browser doesn't open the
      // file in place of the app.
      event.preventDefault();
      addMediaFiles(files, point);
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

  /*
   * Delete or Backspace on a module in a chain joins the modules either side
   * of it, rather than leaving a gap. The bridging wires go in first; React
   * Flow then removes the module and whatever wires it had left.
   */
  const handleBeforeDelete = useCallback(async ({ nodes: doomed }: { nodes: AppNode[] }) => {
    if (doomed.length > 0) useGraph.getState().detachFromChain(doomed.map((node) => node.id));
    return true;
  }, []);

  // Only the groups, compared item by item: a slider moving elsewhere hands
  // the store a new node array but leaves every group as it was.
  const groups = useGraph(useShallow((state) => state.nodes.filter(isGroup)));

  const edgesForFlow = useMemo(() => {
    const drawn = drawnEdges(groups, edges);
    if (!insertTargetEdgeId) return drawn;
    return drawn.map((edge) =>
      edge.id === insertTargetEdgeId ? { ...edge, className: 'edge-insert-target' } : edge,
    );
  }, [groups, edges, insertTargetEdgeId]);

  return (
    <>
      <FullScreenBackground />
      <ReactFlow
        nodes={nodes}
        edges={edgesForFlow}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        // While the add menu holds a wire, React Flow's own line, still
        // chasing the pointer until the button is let go, gives way to it.
        className={quickAdd?.wire ? 'is-wire-pinned' : undefined}
        isValidConnection={isValidConnection}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onReconnect={handleReconnect}
        onReconnectStart={handleReconnectStart}
        onReconnectEnd={handleReconnectEnd}
        onBeforeDelete={handleBeforeDelete}
        edgesReconnectable
        // Generous, because the grab target is a wire end rather than a port.
        reconnectRadius={26}
        // Delete is what most people reach for; Backspace is the library's own.
        deleteKeyCode={['Backspace', 'Delete']}
        // Shift-click adds to the selection, as it does in most editors, and
        // Cmd on a Mac. Not Ctrl, the library's default: Ctrl-drag lifts a
        // module out of its chain, and as a selection key it would drag
        // every other selected module out with it.
        multiSelectionKeyCode={['Shift', 'Meta']}
        // Space is play/pause. Holding it to pan is React Flow's default, and
        // a redundant one here: dragging the empty canvas already pans.
        panActivationKeyCode={null}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        panOnScrollSpeed={1}
        panOnDrag={panOnDrag}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        zoomActivationKeyCode={zoomActivationKeyCode}
        minZoom={0.3}
        maxZoom={2}
        fitView
        fitViewOptions={fitViewOptions}
        proOptions={proOptions}
      >
        <SnapGuides />
        {quickAdd?.wire && <PendingWire wire={quickAdd.wire} />}
        {!backgroundShowing && (
          <Background variant={BackgroundVariant.Dots} gap={26} size={1.4} color="rgba(var(--ink-rgb), 0.16)" />
        )}
      </ReactFlow>
      {quickAdd && <QuickAdd at={quickAdd} from={quickAdd.from} onClose={closeQuickAdd} />}
    </>
  );
};

const handleCanvasContextMenu = (event: React.MouseEvent) => {
  if (
    event.target instanceof HTMLElement &&
    (event.target.tagName === 'INPUT' ||
      event.target.tagName === 'TEXTAREA' ||
      event.target.isContentEditable)
  ) {
    return;
  }
  event.preventDefault();
};

/*
 * The saved project came from a newer build, so this one leaves it alone
 * rather than overwrite what it cannot read. That makes the whole session
 * unsaved, which is worth saying out loud -- once, at load, since it cannot
 * change while the page is open.
 */
const AutosaveNotice: React.FC = () =>
  autosaveBlocked() ? (
    <div className="autosave-notice glass" role="status">
      Your saved project was made by a newer version of this app. Nothing here will be saved -- reload the
      latest version to keep working on it.
    </div>
  ) : null;

export const App: React.FC = () => (
  <div className="app">
    <ReactFlowProvider>
      <main className="canvas-area" onContextMenu={handleCanvasContextMenu}>
        <Editor />
      </main>
      <Toolbar />
      <Transport />
      <HintBar />
      <AboutModal />
      <PresetModal />
      <WelcomeModal />
      <AutosaveNotice />
    </ReactFlowProvider>
  </div>
);
