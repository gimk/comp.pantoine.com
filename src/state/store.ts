import { create } from 'zustand';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react';
import { getEffect } from '../engine/registry';
import { defaultParams, type ParamValue } from '../engine/effects';
import { defaultModulatorParams, getModulator } from '../engine/modulators';
import { decodeImage, dropImage, putImage, shareImage, swapImages } from '../engine/imageStore';
import {
  DEFAULT_PREVIEW_WIDTH,
  identityAliases,
  isModulationEdge,
  samePort,
  type AppNode,
} from './graph';
import { highestIdSuffix, loadGraph, saveGraph } from './document';
import { snapDrag, type Box, type SnapGuide } from './snapping';

/**
 * Whatever was left in local storage, restored before anything else runs.
 *
 * Read once at module load rather than in an effect, so the editor never
 * renders the empty starting graph for a frame and then replaces it --
 * which would flash, and would also fit the view to the wrong thing.
 */
const restored = loadGraph();

// Moved past every id already in the restored document, or the next node
// added would collide with one of them.
let idCounter = restored
  ? highestIdSuffix([...restored.nodes.map((n) => n.id), ...restored.edges.map((e) => e.id)])
  : 0;

const nextId = (prefix: string): string => {
  idCounter += 1;
  return prefix + '-' + idCounter;
};

/** What a fresh id for a copy of this node should be prefixed with. */
const idPrefixFor = (node: AppNode): string => {
  if (node.type === 'effect') return node.data.effectId;
  if (node.type === 'modulator') return node.data.modulatorId;
  return node.type === 'image' ? 'image' : 'output';
};

/** A fresh wire between the same two ports as `edge`. */
const rewire = (edge: Edge, source: string, target: string): Edge => ({
  id: nextId('edge'),
  source,
  target,
  sourceHandle: edge.sourceHandle ?? null,
  targetHandle: edge.targetHandle ?? null,
  type: 'link',
});

/**
 * Copies of a set of nodes, with fresh ids and the wiring a copy keeps.
 *
 * A copy keeps the wires among the copied nodes and the ones feeding in
 * from outside, since an output can fan out to as many inputs as it likes.
 * It never keeps a wire out to a node that was not copied: that input is
 * already taken by the original.
 */
const copySubgraph = (
  picked: AppNode[],
  edges: Edge[],
  liveIds: Set<string>,
  offset: XYPosition,
  imageFrom: (id: string) => string,
): { nodes: AppNode[]; edges: Edge[] } => {
  const ids = new Map(picked.map((node) => [node.id, nextId(idPrefixFor(node))]));

  const nodes = picked.map((node): AppNode => {
    const id = ids.get(node.id)!;
    if (node.type === 'image') shareImage(imageFrom(node.id), id);
    return {
      ...node,
      id,
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
      data: structuredClone(node.data),
      selected: true,
      dragging: false,
    } as AppNode;
  });

  const wires: Edge[] = [];
  for (const edge of edges) {
    const target = ids.get(edge.target);
    if (!target) continue;
    const source = ids.get(edge.source) ?? (liveIds.has(edge.source) ? edge.source : undefined);
    if (source) wires.push(rewire(edge, source, target));
  }

  return { nodes, edges: wires };
};

/*
 * The clipboard is the app's own rather than the system one: a copied node
 * references a decoded bitmap, which the system clipboard cannot carry. It
 * holds its own share of each image, so a cut image node can still be
 * pasted after the original is gone.
 */
const CLIPBOARD_PREFIX = 'clipboard:';
let clipboard: { nodes: AppNode[]; edges: Edge[] } | null = null;

/** Where each node being dragged started, while a drag is in progress. */
let dragOrigins: Map<string, XYPosition> | null = null;
let snapping = false;

/*
 * The part of the graph on screen, in graph units. The store has no view of
 * the viewport, so the canvas hands it a way to ask.
 */
let visibleArea: () => Box | null = () => null;

export const setVisibleAreaSource = (source: () => Box | null): void => {
  visibleArea = source;
};

/** Whether nodes are mid-drag -- history waits for the drop. */
export const isDragging = (): boolean => dragOrigins !== null;

/** Shift, as the canvas sees it: snap a node drag to the other modules. */
export const setSnapping = (on: boolean): void => {
  snapping = on;
  // Let go mid-drag, the guides go at once rather than on the next move.
  if (!on && useGraph.getState().snapGuides.length > 0) useGraph.setState({ snapGuides: [] });
};

/** Original id to the stand-in left behind, while an Alt-drag is in progress. */
let altDuplicate: Map<string, string> | null = null;

/**
 * What a node drag is doing to the graph, besides moving nodes: nothing,
 * lifting them out of their chain (Ctrl), or leaving copies behind (Alt).
 */
export type DragMode = 'move' | 'detach' | 'duplicate';

/*
 * The drag under way: which nodes, the wiring as it was when it began, and
 * the mode in force. The wiring is kept so a mode can be let go of mid-drag
 * and leave the graph exactly as it found it.
 */
let drag: { ids: string[]; edges: Edge[]; mode: DragMode } | null = null;

export const dragMode = (): DragMode => drag?.mode ?? 'move';

/** Take the stand-ins of an Alt-drag away again, as if it had never started. */
const cancelAltDuplicate = (): void => {
  const pairs = altDuplicate;
  altDuplicate = null;
  if (!pairs) return;
  const standIns = new Set(pairs.values());
  for (const standIn of standIns) {
    identityAliases.delete(standIn);
    dropImage(standIn);
  }
  useGraph.setState({ nodes: useGraph.getState().nodes.filter((node) => !standIns.has(node.id)) });
};

/**
 * Ctrl and Alt, as the canvas sees them. Read on every key and pointer
 * event, like Shift, so either can be pressed or let go at any point in a
 * drag and the graph follows: Alt wins over Ctrl, and letting go of both
 * puts the wiring back as it was.
 */
export const setDragModifiers = (keys: { ctrl: boolean; alt: boolean }): void => {
  if (!drag) return;
  const mode: DragMode = keys.alt ? 'duplicate' : keys.ctrl ? 'detach' : 'move';
  if (mode === drag.mode) return;

  // Back to plain moving first, then into the new mode from there.
  if (drag.mode === 'duplicate') cancelAltDuplicate();
  if (drag.mode !== 'move') useGraph.setState({ edges: drag.edges });
  drag.mode = mode;

  const store = useGraph.getState();
  if (mode === 'duplicate') store.beginAltDuplicate(drag.ids);
  if (mode === 'detach') {
    store.detachFromChain(drag.ids);
    // Lifting out and splicing in are opposites; the highlight goes now,
    // not on the next pointer move.
    store.setInsertTarget(null);
  }
};

const initialNodes = (): AppNode[] => [
  {
    id: nextId('image'),
    type: 'image',
    position: { x: 40, y: 140 },
    data: { src: null, name: '', width: 0, height: 0 },
  },
  {
    id: nextId('output'),
    type: 'renderOutput',
    position: { x: 560, y: 180 },
    // Deletable, now that the Output menu can put another one back. A graph
    // with no viewer is a legitimate state, not a broken one.
    data: { width: DEFAULT_PREVIEW_WIDTH },
  },
];

type GraphStore = {
  nodes: AppNode[];
  edges: Edge[];
  /** Link currently highlighted to receive the node being dragged, if any. */
  insertTargetEdgeId: string | null;
  /** Alignment lines to draw while a Shift-drag is snapped to something. */
  snapGuides: SnapGuide[];
  setInsertTarget: (edgeId: string | null) => void;
  insertNodeOnEdge: (nodeId: string, edgeId: string) => void;
  detachFromChain: (ids: string[]) => void;
  onNodesChange: (changes: NodeChange<AppNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  removeEdge: (edgeId: string) => void;
  reconnectLink: (oldEdge: Edge, connection: Connection) => void;
  addEffectNode: (effectId: string, position?: XYPosition) => void;
  addModulatorNode: (modulatorId: string, position?: XYPosition) => void;
  addImageNode: (position?: XYPosition) => void;
  addOutputNode: (position?: XYPosition) => void;
  setParam: (nodeId: string, key: string, value: ParamValue) => void;
  setPreviewWidth: (nodeId: string, width: number) => void;
  loadImage: (nodeId: string, file: File) => Promise<void>;
  beginDrag: (dragged: AppNode[]) => void;
  endDrag: () => void;
  beginAltDuplicate: (ids: string[]) => void;
  endAltDuplicate: () => (id: string) => string;
  duplicateSelection: (offset: XYPosition) => void;
  copySelection: () => boolean;
  cutSelection: () => void;
  paste: (at?: XYPosition) => void;
  removeNodes: (ids: string[]) => void;
  setAllSelected: (selected: boolean) => void;
};

export const useGraph = create<GraphStore>((set, get) => ({
  nodes: restored?.nodes ?? initialNodes(),
  edges: restored?.edges ?? [],
  insertTargetEdgeId: null,
  snapGuides: [],

  setInsertTarget: (edgeId) => {
    // Called on every drag frame, so only touch state when it actually moves.
    if (get().insertTargetEdgeId === edgeId) return;
    set({ insertTargetEdgeId: edgeId });
  },

  /**
   * Splice a node into an existing link: A -> B becomes A -> node -> B.
   *
   * Only an effect qualifies, since it is the only kind with both an input
   * and an output, and only a link carrying a picture -- a modulation wire
   * has nowhere for one to go. The node's main input and its outputs are
   * dropped: it is moving into this link, and an input takes one wire
   * anyway. Its extra inputs and modulation wires stay, since they belong
   * to how the node is set up rather than to where it sits in the flow.
   */
  insertNodeOnEdge: (nodeId, edgeId) => {
    const { nodes, edges } = get();
    const node = nodes.find((candidate) => candidate.id === nodeId);
    const edge = edges.find((candidate) => candidate.id === edgeId);
    if (!node || !edge || node.type !== 'effect' || isModulationEdge(edge)) return;
    if (edge.source === nodeId || edge.target === nodeId) return;

    const kept = edges.filter(
      (candidate) =>
        candidate.id !== edgeId &&
        candidate.source !== nodeId &&
        !(candidate.target === nodeId && samePort(candidate.targetHandle, null)),
    );

    set({
      edges: [
        ...kept,
        { ...rewire(edge, edge.source, nodeId), targetHandle: null },
        { ...rewire(edge, nodeId, edge.target), sourceHandle: null },
      ],
      insertTargetEdgeId: null,
    });
  },

  /**
   * Lift modules out of the flow and close the gap behind them: A -> node
   * -> B becomes A -> B, with the node left unwired on the way in and out.
   * Ctrl-drag does this, and so does deleting a module or cutting it.
   *
   * Only effects qualify, the one kind that sits in a chain rather than at
   * an end of it. Several dragged together come out as a group: wires among
   * them stay, and only the ones crossing into or out of the group are
   * bridged. Extra inputs and modulation wires stay, as they do on an
   * insert, since they are how the node is set up, not where it sits.
   */
  detachFromChain: (ids) => {
    const { nodes, edges } = get();
    const lifted = new Set(
      nodes.filter((node) => ids.includes(node.id) && node.type === 'effect').map((node) => node.id),
    );
    if (lifted.size === 0) return;

    const mainInput = (nodeId: string): Edge | undefined =>
      edges.find((edge) => edge.target === nodeId && samePort(edge.targetHandle, null));

    // Walk back up the main inputs through the group to the first wire that
    // comes from outside it: that is what the gap gets closed with.
    const feedOf = (nodeId: string): Edge | undefined => {
      const seen = new Set<string>();
      let edge = mainInput(nodeId);
      while (edge && lifted.has(edge.source) && !seen.has(edge.source)) {
        seen.add(edge.source);
        edge = mainInput(edge.source);
      }
      return edge && !lifted.has(edge.source) ? edge : undefined;
    };

    const bridges: Edge[] = [];
    const kept = edges.filter((edge) => {
      const out = lifted.has(edge.source) && !lifted.has(edge.target) && !isModulationEdge(edge);
      const into =
        lifted.has(edge.target) && !lifted.has(edge.source) && samePort(edge.targetHandle, null);
      if (out) {
        const feed = feedOf(edge.source);
        if (feed) {
          bridges.push({ ...rewire(edge, feed.source, edge.target), sourceHandle: feed.sourceHandle ?? null });
        }
      }
      return !out && !into;
    });

    if (kept.length === edges.length) return;
    set({ edges: [...kept, ...bridges] });
  },

  onNodesChange: (changes) => {
    // Free the bitmap and its object URL as the node goes, so repeatedly
    // importing and deleting does not leak the decoded pixels.
    for (const change of changes) {
      if (change.type === 'remove') dropImage(change.id);
    }
    // Shift held mid-drag: pull the dragged nodes onto the nearest
    // centre line of another module. The correction is added on top of where
    // React Flow put them, and React Flow works from the pointer each
    // frame, so a snap lets go as soon as the pointer moves past it.
    let guides: SnapGuide[] = [];
    if (dragOrigins && snapping) {
      const origins = dragOrigins;
      const lead = changes.find(
        (change) => change.type === 'position' && change.position && origins.has(change.id),
      );
      if (lead && lead.type === 'position' && lead.position) {
        const origin = origins.get(lead.id)!;
        const delta = { x: lead.position.x - origin.x, y: lead.position.y - origin.y };
        const snap = snapDrag(get().nodes, origins, delta, visibleArea());
        guides = snap.guides;
        changes = changes.map((change) => {
          if (change.type !== 'position' || !change.position || !origins.has(change.id)) return change;
          return {
            ...change,
            position: { x: change.position.x + snap.shift.x, y: change.position.y + snap.shift.y },
          };
        });
      }
    }
    if (guides.length > 0 || get().snapGuides.length > 0) set({ snapGuides: guides });
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection) => {
    // An input takes one wire: connecting to an occupied port replaces what
    // was there, which is what dropping a new link on it is asking for.
    const cleared = get().edges.filter(
      (edge) => edge.target !== connection.target || !samePort(edge.targetHandle, connection.targetHandle),
    );
    set({ edges: addEdge({ ...connection, type: 'link' }, cleared) });
  },

  removeEdge: (edgeId) => {
    set({ edges: get().edges.filter((edge) => edge.id !== edgeId) });
  },

  /**
   * Drag one end of an existing wire onto a different port.
   *
   * An input still takes one wire, so whatever was already on the new
   * target is dropped -- the same rule `onConnect` follows, because this is
   * the same action arrived at from the other direction. The edge being
   * moved is exempt from that sweep, or it would clear itself on the way in.
   */
  reconnectLink: (oldEdge, connection) => {
    const kept = get().edges.filter(
      (edge) =>
        edge.id === oldEdge.id ||
        edge.target !== connection.target ||
        !samePort(edge.targetHandle, connection.targetHandle),
    );
    set({ edges: reconnectEdge(oldEdge, connection, kept) });
  },

  addEffectNode: (effectId, position) => {
    const def = getEffect(effectId);
    if (!def) return;
    const node: AppNode = {
      id: nextId(effectId),
      type: 'effect',
      // Dropped modules land where they were dropped. Added from the menu
      // by click instead, they fan out from a fixed spot so a run of them
      // does not stack into one unreadable pile.
      position: position ?? { x: 280, y: 100 + (get().nodes.length % 6) * 40 },
      data: { effectId, params: defaultParams(def) },
    };
    set({ nodes: [...get().nodes, node] });
  },

  addModulatorNode: (modulatorId, position) => {
    const def = getModulator(modulatorId);
    if (!def) return;
    const node: AppNode = {
      id: nextId(modulatorId),
      type: 'modulator',
      // Sources start in the input column, operators in the module column.
      position: position ?? { x: def.role === 'source' ? 40 : 280, y: 380 + (get().nodes.length % 6) * 40 },
      data: { modulatorId, params: defaultModulatorParams(def) },
    };
    set({ nodes: [...get().nodes, node] });
  },

  addImageNode: (position) => {
    const node: AppNode = {
      id: nextId('image'),
      type: 'image',
      position: position ?? { x: 40, y: 100 + (get().nodes.length % 6) * 40 },
      data: { src: null, name: '', width: 0, height: 0 },
    };
    set({ nodes: [...get().nodes, node] });
  },

  addOutputNode: (position) => {
    const node: AppNode = {
      id: nextId('output'),
      type: 'renderOutput',
      position: position ?? { x: 760, y: 100 + (get().nodes.length % 6) * 40 },
      data: { width: DEFAULT_PREVIEW_WIDTH },
    };
    set({ nodes: [...get().nodes, node] });
  },

  setParam: (nodeId, key, value) => {
    set({
      nodes: get().nodes.map((node) => {
        if (node.id !== nodeId || (node.type !== 'effect' && node.type !== 'modulator')) return node;
        return { ...node, data: { ...node.data, params: { ...node.data.params, [key]: value } } } as AppNode;
      }),
    });
  },

  setPreviewWidth: (nodeId, width) => {
    set({
      nodes: get().nodes.map((node) => {
        if (node.id !== nodeId || node.type !== 'renderOutput') return node;
        return { ...node, data: { ...node.data, width } };
      }),
    });
  },

  loadImage: async (nodeId, file) => {
    const bitmap = await decodeImage(file);
    const url = URL.createObjectURL(file);
    const loaded = putImage(nodeId, bitmap, url, file.name);
    set({
      nodes: get().nodes.map((node) => {
        if (node.id !== nodeId || node.type !== 'image') return node;
        return {
          ...node,
          data: { src: loaded.url, name: loaded.name, width: loaded.width, height: loaded.height },
        };
      }),
    });
  },

  beginDrag: (dragged) => {
    dragOrigins = new Map(dragged.map((node) => [node.id, { ...node.position }]));
    drag = { ids: dragged.map((node) => node.id), edges: get().edges, mode: 'move' };
  },

  endDrag: () => {
    dragOrigins = null;
    drag = null;
    if (get().snapGuides.length > 0) set({ snapGuides: [] });
  },

  /**
   * Alt-drag: leave a copy behind and carry the rest away.
   *
   * React Flow is already dragging the originals by id and cannot be handed
   * different nodes mid-gesture, so for the length of the drag the roles
   * are reversed: a stand-in with a fresh id is dropped where each original
   * was and takes over all of its wiring, while the original travels with
   * the wiring a copy would have. `endAltDuplicate` swaps the ids back, so
   * what stays put is still the original -- same id, same seed, same
   * feedback history -- and what landed is the copy.
   */
  beginAltDuplicate: (ids) => {
    const { nodes, edges } = get();
    const picked = nodes.filter((node) => ids.includes(node.id));
    if (picked.length === 0) return;

    const pairs = new Map(picked.map((node) => [node.id, nextId(idPrefixFor(node))]));
    const standIns = picked.map((node): AppNode => {
      const id = pairs.get(node.id)!;
      if (node.type === 'image') shareImage(node.id, id);
      identityAliases.set(id, node.id);
      return {
        ...node,
        id,
        // Where the original started: Alt may be pressed well into a drag.
        position: dragOrigins?.get(node.id) ?? node.position,
        data: structuredClone(node.data),
        selected: false,
        dragging: false,
      } as AppNode;
    });

    const rewired = edges.map((edge) => ({
      ...edge,
      source: pairs.get(edge.source) ?? edge.source,
      target: pairs.get(edge.target) ?? edge.target,
    }));
    // Wires into the travelling set, from inside it or from outside, stay
    // on the originals as-is: exactly the wiring `copySubgraph` gives a copy.
    const carried = edges
      .filter((edge) => pairs.has(edge.target))
      .map((edge) => rewire(edge, edge.source, edge.target));

    altDuplicate = pairs;
    set({ nodes: [...nodes, ...standIns], edges: [...rewired, ...carried] });
  },

  /** Finish an Alt-drag; returns how ids were renamed, identity if none. */
  endAltDuplicate: () => {
    const pairs = altDuplicate;
    altDuplicate = null;
    if (!pairs) return (id) => id;

    const swap = new Map<string, string>();
    for (const [original, standIn] of pairs) {
      swap.set(original, standIn);
      swap.set(standIn, original);
      swapImages(original, standIn);
      identityAliases.delete(standIn);
    }
    const rename = (id: string): string => swap.get(id) ?? id;

    const { nodes, edges } = get();
    set({
      nodes: nodes.map((node) => (swap.has(node.id) ? { ...node, id: rename(node.id) } : node)),
      edges: edges.map((edge) => ({ ...edge, source: rename(edge.source), target: rename(edge.target) })),
    });
    return rename;
  },

  duplicateSelection: (offset) => {
    const { nodes, edges } = get();
    const picked = nodes.filter((node) => node.selected);
    if (picked.length === 0) return;
    const copy = copySubgraph(picked, edges, new Set(nodes.map((n) => n.id)), offset, (id) => id);
    set({
      nodes: [...nodes.map((node) => (node.selected ? { ...node, selected: false } : node)), ...copy.nodes],
      edges: [...edges, ...copy.edges],
    });
  },

  copySelection: () => {
    const { nodes, edges } = get();
    const picked = nodes.filter((node) => node.selected);
    if (picked.length === 0) return false;

    if (clipboard) {
      for (const node of clipboard.nodes) dropImage(CLIPBOARD_PREFIX + node.id);
    }
    for (const node of picked) {
      if (node.type === 'image') shareImage(node.id, CLIPBOARD_PREFIX + node.id);
    }
    const ids = new Set(picked.map((node) => node.id));
    clipboard = {
      nodes: structuredClone(picked),
      edges: edges.filter((edge) => ids.has(edge.target)).map((edge) => ({ ...edge })),
    };
    return true;
  },

  cutSelection: () => {
    if (!get().copySelection()) return;
    get().removeNodes(get().nodes.filter((node) => node.selected).map((node) => node.id));
  },

  /**
   * Paste with the clipboard's top-left corner at `at`, or offset from
   * where it was copied when there is no pointer position to go by.
   */
  paste: (at) => {
    if (!clipboard || clipboard.nodes.length === 0) return;
    const { nodes, edges } = get();
    const left = Math.min(...clipboard.nodes.map((node) => node.position.x));
    const top = Math.min(...clipboard.nodes.map((node) => node.position.y));
    const offset = at ? { x: at.x - left, y: at.y - top } : { x: 32, y: 32 };
    const copy = copySubgraph(
      clipboard.nodes,
      clipboard.edges,
      new Set(nodes.map((node) => node.id)),
      offset,
      (id) => CLIPBOARD_PREFIX + id,
    );
    set({
      nodes: [...nodes.map((node) => (node.selected ? { ...node, selected: false } : node)), ...copy.nodes],
      edges: [...edges, ...copy.edges],
    });
  },

  removeNodes: (ids) => {
    // A module taken out of a chain closes the gap behind it rather than
    // leaving the chain broken.
    get().detachFromChain(ids);
    const gone = new Set(ids);
    for (const id of gone) dropImage(id);
    set({
      nodes: get().nodes.filter((node) => !gone.has(node.id)),
      edges: get().edges.filter((edge) => !gone.has(edge.source) && !gone.has(edge.target)),
    });
  },

  setAllSelected: (selected) => {
    set({
      nodes: get().nodes.map((node) => (!!node.selected === selected ? node : { ...node, selected })),
      edges: get().edges.map((edge) => (!!edge.selected === selected ? edge : { ...edge, selected })),
    });
  },
}));

/**
 * Autosave.
 *
 * Debounced because the graph changes on every frame of a node drag and
 * every tick of a slider; writing on each would serialize the whole
 * document hundreds of times a second. Only `nodes` and `edges` are
 * watched -- transient state like the highlighted insert target is not part
 * of the document and should not cost a write.
 */
const SAVE_DEBOUNCE_MS = 400;

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastNodes = useGraph.getState().nodes;
let lastEdges = useGraph.getState().edges;

const flushSave = (): void => {
  if (saveTimer === undefined) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  saveGraph(lastNodes, lastEdges);
};

useGraph.subscribe((state) => {
  if (state.nodes === lastNodes && state.edges === lastEdges) return;
  lastNodes = state.nodes;
  lastEdges = state.edges;
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    saveGraph(lastNodes, lastEdges);
  }, SAVE_DEBOUNCE_MS);
});

// A change made in the last fraction of a second before the tab closes is
// still a change the user made, and would otherwise die in the debounce.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushSave);
}
