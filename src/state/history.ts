/**
 * Undo and redo, as snapshots of the document.
 *
 * Nothing records history explicitly. Every change to nodes or edges arms a
 * short timer, and when it settles the graph is compared with the last
 * committed snapshot; if the document differs, that becomes a step. So a
 * slider dragged through two hundred values is one step, a node drag is one
 * step (commits wait for the drop), and selecting a node -- which the saved
 * form does not contain -- is no step at all.
 *
 * Pixels are the awkward part: deleting an image node releases its bitmap,
 * and undoing that has to bring the picture back, not an empty node. Each
 * snapshot therefore holds its own share of every image it shows, under a
 * key of its own, and gives it up when the snapshot falls out of history.
 */
import type { Edge } from '@xyflow/react';
import { dropImage, getImage, shareImage } from '../engine/imageStore';
import type { AppNode } from './graph';
import { serializeGraph } from './document';
import { isDragging, onDragEnd, useGraph } from './store';

const SETTLE_MS = 300;
const MAX_STEPS = 100;

type Snapshot = {
  nodes: AppNode[];
  edges: Edge[];
  /** What makes two snapshots the same document. */
  key: string;
  /** Node id to the image-store key this snapshot holds that node's image under. */
  images: Map<string, string>;
};

let snapshotCounter = 0;

/*
 * The saved form, plus each image's source: loading a different picture
 * into a node changes neither its name slot nor anything else serialized
 * when the file happens to share a name, but it is still an edit.
 */
const documentKey = (nodes: AppNode[], edges: Edge[]): string =>
  JSON.stringify(serializeGraph(nodes, edges)) +
  nodes.map((node) => (node.type === 'image' ? node.data.src ?? '' : '')).join('|');

const take = (nodes: AppNode[], edges: Edge[]): Snapshot => {
  snapshotCounter += 1;
  const images = new Map<string, string>();
  for (const node of nodes) {
    if (node.type !== 'image' || !getImage(node.id)) continue;
    const key = 'history:' + snapshotCounter + ':' + node.id;
    shareImage(node.id, key);
    images.set(node.id, key);
  }
  return {
    nodes: structuredClone(nodes),
    edges: structuredClone(edges),
    key: documentKey(nodes, edges),
    images,
  };
};

const release = (snapshot: Snapshot): void => {
  for (const key of snapshot.images.values()) dropImage(key);
};

const initial = useGraph.getState();
let committed = take(initial.nodes, initial.edges);
const past: Snapshot[] = [];
let future: Snapshot[] = [];

let timer: ReturnType<typeof setTimeout> | undefined;
let restoring = false;

const commit = (): void => {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  if (isDragging()) {
    // The drop will change the graph again and re-arm the timer.
    return;
  }
  const { nodes, edges } = useGraph.getState();
  if (documentKey(nodes, edges) === committed.key) return;

  past.push(committed);
  if (past.length > MAX_STEPS) release(past.shift()!);
  for (const snapshot of future) release(snapshot);
  future = [];
  committed = take(nodes, edges);
};

let lastNodes = initial.nodes;
let lastEdges = initial.edges;

useGraph.subscribe((state) => {
  if (state.nodes === lastNodes && state.edges === lastEdges) return;
  lastNodes = state.nodes;
  lastEdges = state.edges;
  if (restoring) return;
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(commit, SETTLE_MS);
});

// A drop might not change node positions on that exact tick, but settles the drag.
onDragEnd(() => {
  if (restoring) return;
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(commit, SETTLE_MS);
});

/** Put the graph back to a snapshot, pixels included. */
const restore = (snapshot: Snapshot): void => {
  const { nodes: live } = useGraph.getState();
  const kept = new Set(snapshot.nodes.map((node) => node.id));

  for (const node of live) {
    if (node.type === 'image' && !kept.has(node.id)) dropImage(node.id);
  }
  for (const node of snapshot.nodes) {
    if (node.type !== 'image') continue;
    const held = snapshot.images.get(node.id);
    if (held) shareImage(held, node.id);
    else dropImage(node.id);
  }

  restoring = true;
  useGraph.setState({
    // Selection is not part of the document, and restoring an old one would
    // leave the user operating on nodes they did not pick.
    nodes: snapshot.nodes.map((node) => (node.selected ? { ...node, selected: false } : node)),
    edges: snapshot.edges.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)),
    insertTargetEdgeId: null,
  });
  restoring = false;
};

/** Immediately commit the current state to history if different from last snapshot. */
export const commitNow = (): void => {
  commit();
};

export const undo = (): void => {
  if (isDragging()) return;
  // An edit still settling is the one being undone, so land it first.
  commit();
  const previous = past.pop();
  if (!previous) return;
  future.push(committed);
  committed = previous;
  restore(previous);
};

export const redo = (): void => {
  if (isDragging()) return;
  commit();
  const next = future.pop();
  if (!next) return;
  past.push(committed);
  committed = next;
  restore(next);
};

