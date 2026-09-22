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
import { decodeImage, dropImage, putImage } from '../engine/imageStore';
import { DEFAULT_PREVIEW_WIDTH, type AppNode } from './graph';
import { highestIdSuffix, loadGraph, saveGraph } from './document';

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
  setInsertTarget: (edgeId: string | null) => void;
  insertNodeOnEdge: (nodeId: string, edgeId: string) => void;
  onNodesChange: (changes: NodeChange<AppNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  removeEdge: (edgeId: string) => void;
  reconnectLink: (oldEdge: Edge, connection: Connection) => void;
  addEffectNode: (effectId: string, position?: XYPosition) => void;
  addImageNode: (position?: XYPosition) => void;
  addOutputNode: (position?: XYPosition) => void;
  setParam: (nodeId: string, key: string, value: ParamValue) => void;
  setPreviewWidth: (nodeId: string, width: number) => void;
  loadImage: (nodeId: string, file: File) => Promise<void>;
};

export const useGraph = create<GraphStore>((set, get) => ({
  nodes: restored?.nodes ?? initialNodes(),
  edges: restored?.edges ?? [],
  insertTargetEdgeId: null,

  setInsertTarget: (edgeId) => {
    // Called on every drag frame, so only touch state when it actually moves.
    if (get().insertTargetEdgeId === edgeId) return;
    set({ insertTargetEdgeId: edgeId });
  },

  /**
   * Splice a node into an existing link: A -> B becomes A -> node -> B.
   *
   * Only an effect qualifies, since it is the only kind with both an input
   * and an output. Whatever the node was previously wired to is dropped --
   * it is moving into this link, and an input takes one wire anyway.
   */
  insertNodeOnEdge: (nodeId, edgeId) => {
    const { nodes, edges } = get();
    const node = nodes.find((candidate) => candidate.id === nodeId);
    const edge = edges.find((candidate) => candidate.id === edgeId);
    if (!node || !edge || node.type !== 'effect') return;
    if (edge.source === nodeId || edge.target === nodeId) return;

    const kept = edges.filter(
      (candidate) =>
        candidate.id !== edgeId && candidate.source !== nodeId && candidate.target !== nodeId,
    );

    set({
      edges: [
        ...kept,
        { id: nextId('edge'), source: edge.source, target: nodeId, type: 'link' },
        { id: nextId('edge'), source: nodeId, target: edge.target, type: 'link' },
      ],
      insertTargetEdgeId: null,
    });
  },

  onNodesChange: (changes) => {
    // Free the bitmap and its object URL as the node goes, so repeatedly
    // importing and deleting does not leak the decoded pixels.
    for (const change of changes) {
      if (change.type === 'remove') dropImage(change.id);
    }
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection) => {
    // An input takes one wire: connecting to an occupied port replaces what
    // was there, which is what dropping a new link on it is asking for.
    const cleared = get().edges.filter((edge) => edge.target !== connection.target);
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
      (edge) => edge.id === oldEdge.id || edge.target !== connection.target,
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
        if (node.id !== nodeId || node.type !== 'effect') return node;
        return { ...node, data: { ...node.data, params: { ...node.data.params, [key]: value } } };
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
