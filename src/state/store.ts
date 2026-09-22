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
} from '@xyflow/react';
import { getEffect } from '../engine/registry';
import { defaultParams, type ParamValue } from '../engine/effects';
import { decodeImage, dropImage, putImage } from '../engine/imageStore';
import { OUTPUT_NODE_ID, type AppNode } from './graph';

let idCounter = 0;
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
    id: OUTPUT_NODE_ID,
    type: 'renderOutput',
    position: { x: 560, y: 180 },
    // The render view is meaningless without a sink to wire into, so this
    // one node is fixed furniture rather than something to delete by accident.
    deletable: false,
    data: { label: 'Output' },
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
  addEffectNode: (effectId: string) => void;
  addImageNode: () => void;
  setParam: (nodeId: string, key: string, value: ParamValue) => void;
  loadImage: (nodeId: string, file: File) => Promise<void>;
};

export const useGraph = create<GraphStore>((set, get) => ({
  nodes: initialNodes(),
  edges: [],
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

  addEffectNode: (effectId) => {
    const def = getEffect(effectId);
    if (!def) return;
    const node: AppNode = {
      id: nextId(effectId),
      type: 'effect',
      // Offset each new node so a run of them fans out instead of stacking
      // into one unreadable pile.
      position: { x: 280, y: 100 + (get().nodes.length % 6) * 40 },
      data: { effectId, params: defaultParams(def) },
    };
    set({ nodes: [...get().nodes, node] });
  },

  addImageNode: () => {
    const node: AppNode = {
      id: nextId('image'),
      type: 'image',
      position: { x: 40, y: 100 + (get().nodes.length % 6) * 40 },
      data: { src: null, name: '', width: 0, height: 0 },
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
