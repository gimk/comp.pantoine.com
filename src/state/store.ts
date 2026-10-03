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
import { getGenerator } from '../engine/generators';
import { defaultParams, type ParamValue } from '../engine/effects';
import { defaultModulatorParams, getModulator } from '../engine/modulators';
import { decodeImage, dropImage, putImage, shareImage, swapImages } from '../engine/imageStore';
import {
  cloneVideo,
  configureVideo,
  createVideoElementFromFile,
  discardVideo,
  dropVideo,
  pauseVideo,
  putVideo,
  shareVideo,
  swapVideos,
} from '../engine/videoStore';
import {
  DEFAULT_BACKGROUND_DATA,
  DEFAULT_EXPORT_DATA,
  DEFAULT_PREVIEW_WIDTH,
  DEFAULT_RENDER_DATA,
  identityAliases,
  carriesRenderAsset,
  clampRenderData,
  isModulationEdge,
  isRenderEdge,
  samePort,
  type AppNode,
  type BackgroundNodeData,
  type ExportNodeData,
  type ExposedParam,
  type RenderNodeData,
  type VideoNodeData,
} from './graph';
import { highestIdSuffix, loadGraph, saveGraph } from './document';
import { snapDrag, type Box, type SnapGuide } from './snapping';
import { isValidConnection, wouldCreateCycle } from './connections';
import { useRenderJobs } from './renderJobs';
import { exposePorts, isGroup, planGroup, realWire, ungroupOffset, withMembers } from './groups';

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
  if (node.type === 'moduleGroup') return 'group';
  if (node.type === 'effect') return node.data.effectId;
  if (node.type === 'generator') return node.data.generatorId;
  if (node.type === 'modulator') return node.data.modulatorId;
  if (node.type === 'render') return 'render';
  if (node.type === 'export') return 'export';
  if (node.type === 'backgroundOutput') return 'background';
  if (node.type === 'video') return 'video';
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
 * A node's data as a copy of it should carry it: deep-copied, and with any
 * reference to another node's id renamed through `rename` -- or dropped, if
 * that node is not coming along: a speed helper's mark, and a group's
 * members and the ports and params it shows for them.
 */
const copyData = (node: AppNode, rename: (id: string) => string | undefined): AppNode['data'] => {
  const data = structuredClone(node.data);
  if (node.type === 'moduleGroup') {
    const group = data as typeof node.data;
    const renamePorts = <P extends { node: string }>(ports: P[]): P[] =>
      ports.flatMap((port) => {
        const id = rename(port.node);
        return id ? [{ ...port, node: id }] : [];
      });
    group.members = group.members.flatMap((member) => rename(member) ?? []);
    group.inputs = renamePorts(group.inputs);
    group.outputs = renamePorts(group.outputs);
    if (group.exposed) group.exposed = renamePorts(group.exposed);
  }
  if (node.type === 'modulator' && node.data.helperFor) {
    const helperFor = rename(node.data.helperFor);
    if (helperFor) (data as typeof node.data).helperFor = helperFor;
    else delete (data as typeof node.data).helperFor;
  }
  return data;
};

/**
 * Copies of a set of nodes, with fresh ids and the wiring a copy keeps.
 *
 * A copy keeps the wires among the copied nodes and the ones feeding in
 * from outside, since an output can fan out to as many inputs as it likes.
 * It never keeps a wire out to a node that was not copied: that input is
 * already taken by the original.
 *
 * A copied video gets an element of its own, not a share of the original's:
 * loop, speed and playhead are per node, and a shared element would have the
 * two fighting over them.
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
    if (node.type === 'video') cloneVideo(imageFrom(node.id), id);
    return {
      ...node,
      id,
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
      data: copyData(node, (other) => ids.get(other)),
      // A group's members come along hidden, and stay out of the selection.
      selected: !node.hidden,
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

const dragEndListeners = new Set<() => void>();

export const onDragEnd = (listener: () => void): (() => void) => {
  dragEndListeners.add(listener);
  return () => {
    dragEndListeners.delete(listener);
  };
};

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
  for (const [original, standIn] of pairs) {
    identityAliases.delete(standIn);
    dropImage(standIn);
    // The stand-in was lent the original's element (see beginAltDuplicate);
    // it goes back before the fresh one is let go.
    swapVideos(original, standIn);
    pauseVideo(standIn);
    dropVideo(standIn);
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
  // A group is its members as well, and a stand-in cannot be left behind
  // for them; Alt on a group just moves it.
  const ids = drag.ids;
  if (mode === 'duplicate' && !store.nodes.some((node) => ids.includes(node.id) && isGroup(node))) {
    store.beginAltDuplicate(ids);
  }
  if (mode === 'detach') {
    store.detachFromChain(drag.ids);
    // Lifting out and splicing in are opposites; the highlight goes now,
    // not on the next pointer move.
    store.setInsertTarget(null);
  }
};

/**
 * The speed helpers that should go with a set of deleted videos: marked as
 * that video's helper, still wired to it, and wired to nothing that is
 * staying. One the user has put to other use stays put.
 */
const orphanedHelpers = (nodes: AppNode[], edges: Edge[], gone: Set<string>): string[] =>
  nodes
    .filter((node) => {
      if (node.type !== 'modulator' || gone.has(node.id)) return false;
      const video = node.data.helperFor;
      if (!video || !gone.has(video)) return false;
      const own = edges.filter((edge) => edge.source === node.id || edge.target === node.id);
      return (
        own.some((edge) => edge.source === node.id && edge.target === video) &&
        own.every((edge) => gone.has(edge.source === node.id ? edge.target : edge.source))
      );
    })
    .map((node) => node.id);

/**
 * Let go of what the store holds for nodes leaving the graph: pixels, a
 * video's element (paused first -- an undo snapshot may keep it alive, and it
 * must not play on unseen), and a Render node's baked file.
 */
const retire = (nodes: AppNode[], gone: Set<string>): void => {
  for (const node of nodes) {
    if (!gone.has(node.id)) continue;
    if (node.type === 'image') dropImage(node.id);
    if (node.type === 'video') {
      pauseVideo(node.id);
      dropVideo(node.id);
    }
    if (node.type === 'render') useRenderJobs.getState().clear(node.id);
  }
};

/**
 * Apply `update` to one node, keeping the same array -- and so not waking
 * every subscriber -- when it hands the node back unchanged.
 */
const updateNode = (nodes: AppNode[], nodeId: string, update: (node: AppNode) => AppNode): AppNode[] => {
  const index = nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) return nodes;
  const next = update(nodes[index]);
  if (next === nodes[index]) return nodes;
  const copy = nodes.slice();
  copy[index] = next;
  return copy;
};

/** Whether merging `patch` into `data` would change anything. */
const differs = <T extends object>(data: T, patch: Partial<T>): boolean =>
  (Object.keys(patch) as (keyof T)[]).some((key) => !Object.is(data[key], patch[key]));

/**
 * Whether an effect may be spliced into this wire: one carrying a live
 * picture, not a modulation signal and not a baked file. Exported for the
 * canvas, which asks while a node is dragged over wires.
 */
export const canSpliceInto = (nodes: AppNode[], edges: Edge[], edge: Edge): boolean =>
  !isModulationEdge(edge) && !isRenderEdge(edge) && !carriesRenderAsset(nodes, edges, edge.source);

/* Latest load request per node, so a slow decode that finishes after a newer one is ignored. */
const loadRequests = new Map<string, number>();
let loadCounter = 0;

const beginLoad = (nodeId: string): number => {
  loadCounter += 1;
  loadRequests.set(nodeId, loadCounter);
  return loadCounter;
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
  addGeneratorNode: (generatorId: string, position?: XYPosition) => void;
  addModulatorNode: (modulatorId: string, position?: XYPosition) => void;
  /** Both return the new node's id, so a dropped file can be loaded straight into it. */
  addImageNode: (position?: XYPosition) => string;
  addVideoNode: (position?: XYPosition) => string;
  addOutputNode: (position?: XYPosition) => void;
  addRenderNode: (position?: XYPosition) => void;
  addExportNode: (position?: XYPosition) => void;
  addBackgroundNode: (position?: XYPosition) => void;
  setParam: (nodeId: string, key: string, value: ParamValue) => void;
  /** Several params of one node at once: one change, one undo step. */
  setEffectParams: (nodeId: string, patch: Record<string, ParamValue>) => void;
  setGeneratorResolution: (nodeId: string, width: number, height: number) => void;
  setPreviewWidth: (nodeId: string, width: number) => void;
  setBackgroundData: (nodeId: string, patch: Partial<BackgroundNodeData>) => void;
  backgroundFps: number | null;
  setBackgroundFps: (fps: number | null) => void;
  setRenderData: (nodeId: string, patch: Partial<RenderNodeData>) => void;
  setExportData: (nodeId: string, patch: Partial<ExportNodeData>) => void;
  setVideoData: (nodeId: string, patch: Partial<VideoNodeData>) => void;
  loadImage: (nodeId: string, file: File) => Promise<void>;
  loadVideo: (nodeId: string, file: File) => Promise<void>;
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
  /** Collapse the selection into a group; returns why not, if it cannot. */
  groupSelection: () => string | null;
  /** Open a group back out into its modules, where the card has been moved to. */
  ungroup: (groupId: string) => void;
  /** The member params a group shows on its card. */
  setGroupExposed: (groupId: string, exposed: ExposedParam[]) => void;
  /**
   * Stamp out a preset's modules, grouped under its name with its params
   * exposed, top-left at `position`.
   */
  insertPreset: (
    preset: { nodes: AppNode[]; edges: Edge[] },
    settings: { name: string; exposed: ExposedParam[] },
    position?: XYPosition,
  ) => void;
  renameGroup: (groupId: string, name: string) => void;
};

/**
 * Center position on the currently visible area of the canvas, or a sensible
 * fallback if the visible area is not yet known.
 */
const defaultNodePosition = (nodeCount = 0, width = 196, height = 120): XYPosition => {
  const area = visibleArea();
  if (area) {
    const stagger = (nodeCount % 6) * 20;
    return {
      x: Math.round((area.left + area.right) / 2 - width / 2) + stagger,
      y: Math.round((area.top + area.bottom) / 2 - height / 2) + stagger,
    };
  }
  return { x: 280, y: 100 + (nodeCount % 6) * 40 };
};

export const useGraph = create<GraphStore>((set, get) => ({
  nodes: restored?.nodes ?? initialNodes(),
  edges: restored?.edges ?? [],
  insertTargetEdgeId: null,
  snapGuides: [],
  backgroundFps: null,

  setBackgroundFps: (fps) => {
    if (get().backgroundFps === fps) return;
    set({ backgroundFps: fps });
  },

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
   *
   * Nor does a wire carrying a baked file: an effect works on live
   * pictures, and there is no picture on it to work on. And a splice that
   * would close a loop through the node's extra inputs is refused, like any
   * other wire that would.
   */
  insertNodeOnEdge: (nodeId, edgeId) => {
    const { nodes, edges } = get();
    const node = nodes.find((candidate) => candidate.id === nodeId);
    const edge = edges.find((candidate) => candidate.id === edgeId);
    if (!node || !edge || node.type !== 'effect' || !canSpliceInto(nodes, edges, edge)) return;
    if (edge.source === nodeId || edge.target === nodeId) return;

    const kept = edges.filter(
      (candidate) =>
        candidate.id !== edgeId &&
        candidate.source !== nodeId &&
        !(candidate.target === nodeId && samePort(candidate.targetHandle, null)),
    );
    const into: Edge = { ...rewire(edge, edge.source, nodeId), targetHandle: null };
    const out: Edge = { ...rewire(edge, nodeId, edge.target), sourceHandle: null };
    if (wouldCreateCycle(kept, into) || wouldCreateCycle([...kept, into], out)) return;

    set({
      edges: [...kept, into, out],
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
    // importing and deleting does not leak the decoded pixels -- and take a
    // video's untouched speed helper with it.
    const removed = new Set(changes.flatMap((change) => (change.type === 'remove' ? [change.id] : [])));
    if (removed.size > 0) {
      const { nodes, edges } = get();
      // A group goes with everything in it.
      const extra = [...withMembers(nodes, removed)].filter((id) => !removed.has(id));
      extra.forEach((id) => removed.add(id));
      extra.push(...orphanedHelpers(nodes, edges, removed));
      for (const id of extra) {
        removed.add(id);
        changes = [...changes, { type: 'remove', id }];
      }
      retire(nodes, removed);
      // React Flow sends the removed nodes' wires separately; the wires of
      // what it did not know was going are ours to take.
      if (extra.length > 0) {
        set({ edges: edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)) });
      }
    }
    // A hidden group member is never picked, however it is asked for.
    const hidden = new Set(get().nodes.filter((node) => node.hidden).map((node) => node.id));
    if (hidden.size > 0) {
      changes = changes.filter((change) => !(change.type === 'select' && change.selected && hidden.has(change.id)));
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
        const snap = snapDrag(
          get().nodes.filter((node) => !node.hidden),
          origins,
          delta,
          visibleArea(),
        );
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

  onConnect: (drawn) => {
    // A wire to a group's card is a wire to the module inside.
    const connection = realWire(get().nodes, drawn);
    // The canvas checks as the wire is dragged; this is for every other way in.
    if (!isValidConnection(get().nodes, get().edges, connection)) return;
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
  reconnectLink: (drawnEdge, drawn) => {
    // Both may name a group's card rather than the module inside; the edge
    // in the store, under the same id, is always the real one.
    const oldEdge = get().edges.find((edge) => edge.id === drawnEdge.id);
    if (!oldEdge) return;
    const connection = realWire(get().nodes, drawn);
    const others = get().edges.filter((edge) => edge.id !== oldEdge.id);
    if (!isValidConnection(get().nodes, others, connection)) return;
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
    const fallback = defaultNodePosition(get().nodes.length, 196, 120);
    const node: AppNode = {
      id: nextId(effectId),
      type: 'effect',
      position: position ?? fallback,
      data: { effectId, params: defaultParams(def) },
    };
    set({ nodes: [...get().nodes, node] });
  },

  addGeneratorNode: (generatorId, position) => {
    const def = getGenerator(generatorId) ?? getEffect(generatorId);
    const params = def ? defaultParams(def) : {};
    const fallback = defaultNodePosition(get().nodes.length, 196, 220);
    const node: AppNode = {
      id: nextId(generatorId),
      type: 'generator',
      position: position ?? fallback,
      data: {
        generatorId,
        width: 1280,
        height: 720,
        params,
      },
    };
    set({ nodes: [...get().nodes, node] });
  },

  addModulatorNode: (modulatorId, position) => {
    const def = getModulator(modulatorId);
    if (!def) return;
    const fallback = defaultNodePosition(get().nodes.length, 196, 120);
    const node: AppNode = {
      id: nextId(modulatorId),
      type: 'modulator',
      position: position ?? fallback,
      data: { modulatorId, params: defaultModulatorParams(def) },
    };
    set({ nodes: [...get().nodes, node] });
  },

  addImageNode: (position) => {
    const fallback = defaultNodePosition(get().nodes.length, 196, 140);
    const node: AppNode = {
      id: nextId('image'),
      type: 'image',
      position: position ?? fallback,
      data: { src: null, name: '', width: 0, height: 0 },
    };
    set({ nodes: [...get().nodes, node] });
    return node.id;
  },

  addVideoNode: (position) => {
    const fallback = defaultNodePosition(get().nodes.length, 196, 140);
    const node: AppNode = {
      id: nextId('video'),
      type: 'video',
      position: position ?? fallback,
      data: {
        src: null,
        name: '',
        width: 0,
        height: 0,
        duration: 0,
        speed: 1,
        loop: true,
        muted: true,
        playbackRate: 1,
      },
    };
    set({ nodes: [...get().nodes, node] });
    return node.id;
  },

  addOutputNode: (position) => {
    const fallback = defaultNodePosition(get().nodes.length, DEFAULT_PREVIEW_WIDTH, 300);
    const node: AppNode = {
      id: nextId('output'),
      type: 'renderOutput',
      position: position ?? fallback,
      data: { width: DEFAULT_PREVIEW_WIDTH },
    };
    set({ nodes: [...get().nodes, node] });
  },

  addRenderNode: (position) => {
    const fallback = defaultNodePosition(get().nodes.length, 220, 160);
    const node: AppNode = {
      id: nextId('render'),
      type: 'render',
      position: position ?? fallback,
      data: { ...DEFAULT_RENDER_DATA },
    };
    set({ nodes: [...get().nodes, node] });
  },

  addExportNode: (position) => {
    const fallback = defaultNodePosition(get().nodes.length, 220, 160);
    const node: AppNode = {
      id: nextId('export'),
      type: 'export',
      position: position ?? fallback,
      data: { ...DEFAULT_EXPORT_DATA },
    };
    set({ nodes: [...get().nodes, node] });
  },

  addBackgroundNode: (position) => {
    const fallback = defaultNodePosition(get().nodes.length, 220, 160);
    const node: AppNode = {
      id: nextId('background'),
      type: 'backgroundOutput',
      position: position ?? fallback,
      data: { ...DEFAULT_BACKGROUND_DATA },
    };
    set({ nodes: [...get().nodes, node] });
  },

  setParam: (nodeId, key, value) => {
    get().setEffectParams(nodeId, { [key]: value });
  },

  setEffectParams: (nodeId, patch) => {
    const nodes = updateNode(get().nodes, nodeId, (node) => {
      if (node.type !== 'effect' && node.type !== 'modulator' && node.type !== 'generator') return node;
      if (!differs(node.data.params, patch)) return node;
      return { ...node, data: { ...node.data, params: { ...node.data.params, ...patch } } } as AppNode;
    });
    if (nodes !== get().nodes) set({ nodes });
  },

  setGeneratorResolution: (nodeId, width, height) => {
    const nodes = updateNode(get().nodes, nodeId, (node) => {
      if (node.type !== 'generator' || !differs(node.data, { width, height })) return node;
      return { ...node, data: { ...node.data, width, height } };
    });
    if (nodes !== get().nodes) set({ nodes });
  },

  setPreviewWidth: (nodeId, width) => {
    const nodes = updateNode(get().nodes, nodeId, (node) => {
      if (node.type !== 'renderOutput' || node.data.width === width) return node;
      return { ...node, data: { ...node.data, width } };
    });
    if (nodes !== get().nodes) set({ nodes });
  },

  setBackgroundData: (nodeId, patch) => {
    const nodes = updateNode(get().nodes, nodeId, (node) => {
      if (node.type !== 'backgroundOutput' || !differs(node.data, patch)) return node;
      return { ...node, data: { ...node.data, ...patch } };
    });
    if (nodes !== get().nodes) set({ nodes });
  },

  /**
   * Change a Render node's recipe. The result is brought within what the
   * format can do (see RENDER_LIMITS) -- switching to GIF pulls a 60 fps,
   * two-minute setting down to something GIF can hold.
   */
  setRenderData: (nodeId, patch) => {
    const nodes = updateNode(get().nodes, nodeId, (node) => {
      if (node.type !== 'render') return node;
      const data = clampRenderData({ ...node.data, ...patch });
      if (!differs(node.data, data)) return node;
      return { ...node, data };
    });
    if (nodes !== get().nodes) set({ nodes });
  },

  setExportData: (nodeId, patch) => {
    const nodes = updateNode(get().nodes, nodeId, (node) => {
      if (node.type !== 'export' || !differs(node.data, patch)) return node;
      return { ...node, data: { ...node.data, ...patch } };
    });
    if (nodes !== get().nodes) set({ nodes });
  },

  setVideoData: (nodeId, patch) => {
    configureVideo(nodeId, patch);
    const nodes = updateNode(get().nodes, nodeId, (node) => {
      if (node.type !== 'video' || !differs(node.data, patch)) return node;
      return { ...node, data: { ...node.data, ...patch } };
    });
    if (nodes !== get().nodes) set({ nodes });
  },

  /*
   * Loading is asynchronous, and a lot can happen before a file finishes
   * decoding: a second file dropped on the same node, or the node deleted.
   * Each load takes a ticket; one that is no longer the latest for its node,
   * or whose node has gone, throws its result away rather than overwriting
   * a newer picture or leaking into a store entry nothing will ever free.
   */
  loadImage: async (nodeId, file) => {
    const ticket = beginLoad(nodeId);
    const current = (): boolean =>
      loadRequests.get(nodeId) === ticket && get().nodes.some((node) => node.id === nodeId && node.type === 'image');
    try {
      const bitmap = await decodeImage(file);
      if (!current()) {
        bitmap.close();
        return;
      }
      loadRequests.delete(nodeId);
      const url = URL.createObjectURL(file);
      const loaded = putImage(nodeId, bitmap, url, file.name);
      set({
        nodes: get().nodes.map((node) => {
          if (node.id !== nodeId || node.type !== 'image') return node;
          return {
            ...node,
            data: { src: loaded.url, name: loaded.name, width: loaded.width, height: loaded.height, error: null },
          };
        }),
      });
    } catch (err) {
      if (!current()) return;
      loadRequests.delete(nodeId);
      const message = err instanceof Error ? err.message : 'Could not decode image file';
      set({
        nodes: get().nodes.map((node) => {
          if (node.id !== nodeId || node.type !== 'image') return node;
          return {
            ...node,
            data: { ...node.data, error: message },
          };
        }),
      });
    }
  },

  loadVideo: async (nodeId, file) => {
    const ticket = beginLoad(nodeId);
    const current = (): boolean =>
      loadRequests.get(nodeId) === ticket && get().nodes.some((node) => node.id === nodeId && node.type === 'video');
    try {
      const { element, url, width, height, duration } = await createVideoElementFromFile(file);
      if (!current()) {
        discardVideo(element, url);
        return;
      }
      loadRequests.delete(nodeId);
      const targetNode = get().nodes.find((n) => n.id === nodeId);
      const isLoop = targetNode?.type === 'video' && targetNode.data.loop !== undefined ? targetNode.data.loop : true;
      const loaded = putVideo(nodeId, element, url, file.name, width, height, duration);
      configureVideo(nodeId, {
        loop: isLoop,
        speed: targetNode?.type === 'video' ? targetNode.data.speed : undefined,
      });
      set({
        nodes: get().nodes.map((node) => {
          if (node.id !== nodeId || node.type !== 'video') return node;
          return {
            ...node,
            data: {
              ...node.data,
              src: loaded.url,
              name: loaded.name,
              width: loaded.width,
              height: loaded.height,
              duration: loaded.duration,
              loop: isLoop,
              error: null,
            },
          };
        }),
      });
    } catch (err) {
      if (!current()) return;
      loadRequests.delete(nodeId);
      const message = err instanceof Error ? err.message : 'Could not decode video file';
      set({
        nodes: get().nodes.map((node) => {
          if (node.id !== nodeId || node.type !== 'video') return node;
          return {
            ...node,
            data: { ...node.data, error: message },
          };
        }),
      });
    }
  },

  beginDrag: (dragged) => {
    dragOrigins = new Map(dragged.map((node) => [node.id, { ...node.position }]));
    drag = { ids: dragged.map((node) => node.id), edges: get().edges, mode: 'move' };
  },

  endDrag: () => {
    dragOrigins = null;
    drag = null;
    if (get().snapGuides.length > 0) set({ snapGuides: [] });
    for (const listener of dragEndListeners) listener();
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
      if (node.type === 'video') {
        // The stand-in stays where the original was and ends up as the
        // original, so it is lent the playing element and the traveller gets
        // the fresh one; the swap in endAltDuplicate hands both back.
        cloneVideo(node.id, id);
        swapVideos(node.id, id);
      }
      identityAliases.set(id, node.id);
      return {
        ...node,
        id,
        // Where the original started: Alt may be pressed well into a drag.
        position: dragOrigins?.get(node.id) ?? node.position,
        data: copyData(node, (other) => pairs.get(other) ?? other),
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
      swapVideos(original, standIn);
      identityAliases.delete(standIn);
    }
    const rename = (id: string): string => swap.get(id) ?? id;

    const { nodes, edges } = get();
    // A speed helper's mark names a node id too, and follows the same swap.
    const renamed = (node: AppNode): AppNode =>
      node.type === 'modulator' && node.data.helperFor && swap.has(node.data.helperFor)
        ? { ...node, data: { ...node.data, helperFor: rename(node.data.helperFor) } }
        : node;
    set({
      nodes: nodes.map((node) => renamed(swap.has(node.id) ? { ...node, id: rename(node.id) } : node)),
      edges: edges.map((edge) => ({ ...edge, source: rename(edge.source), target: rename(edge.target) })),
    });
    return rename;
  },

  duplicateSelection: (offset) => {
    const { nodes, edges } = get();
    const ids = withMembers(nodes, nodes.filter((node) => node.selected).map((node) => node.id));
    const picked = nodes.filter((node) => ids.has(node.id));
    if (picked.length === 0) return;
    const copy = copySubgraph(picked, edges, new Set(nodes.map((n) => n.id)), offset, (id) => id);
    set({
      nodes: [...nodes.map((node) => (node.selected ? { ...node, selected: false } : node)), ...copy.nodes],
      edges: [...edges, ...copy.edges],
    });
  },

  copySelection: () => {
    const { nodes, edges } = get();
    const wanted = withMembers(nodes, nodes.filter((node) => node.selected).map((node) => node.id));
    const picked = nodes.filter((node) => wanted.has(node.id));
    if (picked.length === 0) return false;

    if (clipboard) {
      for (const node of clipboard.nodes) {
        dropImage(CLIPBOARD_PREFIX + node.id);
        dropVideo(CLIPBOARD_PREFIX + node.id);
      }
    }
    for (const node of picked) {
      if (node.type === 'image') shareImage(node.id, CLIPBOARD_PREFIX + node.id);
      if (node.type === 'video') shareVideo(node.id, CLIPBOARD_PREFIX + node.id);
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
    const gone = withMembers(get().nodes, ids);
    for (const id of orphanedHelpers(get().nodes, get().edges, gone)) gone.add(id);
    retire(get().nodes, gone);
    set({
      nodes: get().nodes.filter((node) => !gone.has(node.id)),
      edges: get().edges.filter((edge) => !gone.has(edge.source) && !gone.has(edge.target)),
    });
  },

  setAllSelected: (selected) => {
    set({
      nodes: get().nodes.map((node) =>
        !!node.selected === selected || (selected && node.hidden) ? node : { ...node, selected },
      ),
      edges: get().edges.map((edge) => (!!edge.selected === selected ? edge : { ...edge, selected })),
    });
  },

  /*
   * Grouping only hides the members and puts a card in front of them; the
   * wiring is not touched (see `groups`). So ungrouping is exact: the
   * modules come back as they were, wires and all.
   */
  groupSelection: () => {
    const { nodes, edges } = get();
    const result = planGroup(
      nodes,
      edges,
      nodes.filter((node) => node.selected).map((node) => node.id),
    );
    if ('reason' in result) return result.reason;
    const { plan } = result;
    const members = new Set(plan.data.members);
    // A group taken into this one is dissolved into it.
    const absorbed = new Set(nodes.filter((node) => node.selected && isGroup(node)).map((node) => node.id));
    const group: AppNode = {
      id: nextId('group'),
      type: 'moduleGroup',
      position: plan.position,
      data: plan.data,
      selected: true,
    };
    set({
      nodes: [
        ...nodes
          .filter((node) => !absorbed.has(node.id))
          .map((node) => {
            if (members.has(node.id)) return { ...node, hidden: true, selected: false };
            return node.selected ? { ...node, selected: false } : node;
          }),
        group,
      ],
    });
    // A selected wire inside would stay selected out of sight.
    const inside = (edge: Edge) => edge.selected && (members.has(edge.source) || members.has(edge.target));
    if (edges.some(inside)) set({ edges: edges.map((edge) => (inside(edge) ? { ...edge, selected: false } : edge)) });
    return null;
  },

  ungroup: (groupId) => {
    const { nodes } = get();
    const group = nodes.find((node) => node.id === groupId);
    if (!isGroup(group)) return;
    const members = new Set(group.data.members);
    const offset = ungroupOffset(group, nodes.filter((node) => members.has(node.id)));
    set({
      nodes: nodes.flatMap((node): AppNode[] => {
        if (node.id === groupId) return [];
        if (members.has(node.id)) {
          const shown = { ...node, position: { x: node.position.x + offset.x, y: node.position.y + offset.y }, selected: true };
          delete shown.hidden;
          return [shown];
        }
        return node.selected ? [{ ...node, selected: false }] : [node];
      }),
    });
  },

  /*
   * A preset is a macro: fresh copies of its modules, wired among themselves
   * and to nothing else, then grouped as though the user had selected them
   * and pressed Ctrl+G. Its pictures come from a key no node holds, so an
   * image module in it arrives empty even when its old id matches a live one.
   */
  insertPreset: (preset, settings, position) => {
    if (preset.nodes.length === 0) return;
    const { nodes, edges } = get();
    const left = Math.min(...preset.nodes.map((node) => node.position.x));
    const top = Math.min(...preset.nodes.map((node) => node.position.y));
    const at = position ?? defaultNodePosition(nodes.length, 220);
    const copy = copySubgraph(preset.nodes, preset.edges, new Set(), { x: at.x - left, y: at.y - top }, (id) => 'preset:' + id);
    set({
      nodes: [...nodes.map((node) => (node.selected ? { ...node, selected: false } : node)), ...copy.nodes],
      edges: [...edges.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)), ...copy.edges],
    });
    if (get().groupSelection() !== null) return;
    const group = get().nodes.find((node) => node.selected && isGroup(node));
    if (!group) return;
    get().renameGroup(group.id, settings.name);
    // The copies come back in the preset's order, so the nth is the nth's.
    const renamed = new Map(preset.nodes.map((node, index) => [node.id, copy.nodes[index].id]));
    get().setGroupExposed(
      group.id,
      settings.exposed.flatMap((param) => {
        const node = renamed.get(param.node);
        return node ? [{ ...param, node }] : [];
      }),
    );
  },

  // An exposed param takes a wire on the card, so it brings a port with it.
  setGroupExposed: (groupId, exposed) => {
    const { nodes: all, edges } = get();
    const nodes = updateNode(all, groupId, (node) => {
      if (!isGroup(node)) return node;
      return { ...node, data: { ...node.data, exposed, inputs: exposePorts(node, all, edges, exposed) } };
    });
    if (nodes !== get().nodes) set({ nodes });
  },

  renameGroup: (groupId, name) => {
    const nodes = updateNode(get().nodes, groupId, (node) => {
      if (node.type !== 'moduleGroup' || node.data.name === name) return node;
      return { ...node, data: { ...node.data, name } };
    });
    if (nodes !== get().nodes) set({ nodes });
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
