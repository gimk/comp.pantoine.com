/**
 * The saved form of a graph.
 *
 * Kept deliberately separate from the store: this same format is what a
 * preset or a saved group will be made of, and those are subgraphs rather
 * than whole documents. Anything that assumes it is describing the entire
 * editor would have to be unpicked to get there.
 *
 * Pixels are not in it. An image node records what was loaded -- the name
 * and the dimensions -- but the bitmap stays in `imageStore` and is not
 * serialized: a single photo would exhaust the storage quota on its own,
 * and a preset has no business carrying somebody's picture around inside
 * it. A restored image node comes back empty, naming the file it wants.
 */
import type { Edge, XYPosition } from '@xyflow/react';
import { paramsOf, type ParamSpec, type ParamValue } from '../engine/effects';
import { getEffect } from '../engine/registry';
import { getGenerator } from '../engine/generators';
import { getModulator, modulatorParamsOf } from '../engine/modulators';
import {
  DEFAULT_BACKGROUND_DATA,
  DEFAULT_PREVIEW_WIDTH,
  DEFAULT_RENDER_DATA,
  clampRenderData,
  hasTargetPort,
  samePort,
  type AppNode,
  type ExportFormat,
  type GroupPort,
} from './graph';
import { canJoinGroup } from './groups';
import { isValidConnection, wouldCreateCycle } from './connections';

/**
 * Bumped when the shape changes in a way older documents cannot satisfy.
 *
 * 2 added modulator nodes and named ports on edges. A version 1 document
 * is still read: it has neither, and without them it means exactly what it
 * meant before -- every wire into the one input a node had.
 *
 * 3 added video, generator, render, export and background nodes, and the
 * mark on a video's speed helper. They arrived while the number still said
 * 2, so a version 2 document may already hold any of them and is read the
 * same way; the one real migration is the render node's old name,
 * 'formatter'. The bump is for the other direction: a build that only knows
 * 2 would drop every node kind it has not heard of and save the remains
 * over the document, where the version stops it at the door instead.
 *
 * 4 added groups. A build that knows only 3 would drop them and show their
 * members loose, which loses nothing -- but it would then save that over
 * the document, so the bump keeps it out.
 */
export const DOCUMENT_VERSION = 4;

/** Older versions this build still reads, migrated on the way in. */
const READABLE_VERSIONS = new Set([1, 2, 3, DOCUMENT_VERSION]);

/*
 * The largest things a document may ask for. Anything outside is a
 * hand-edited or damaged document, and is put back to the default rather
 * than handed to the renderer to allocate.
 */
const MAX_GENERATOR_SIZE = 8192;
const MIN_VIDEO_SPEED = 0.0625;
const MAX_VIDEO_SPEED = 16;

type SerializedNode =
  | { id: string; type: 'image'; position: XYPosition; name: string; width: number; height: number }
  | {
      id: string;
      type: 'video';
      position: XYPosition;
      name: string;
      width: number;
      height: number;
      duration: number;
      speed?: number;
      loop?: boolean;
      muted?: boolean;
      playbackRate?: number;
    }
  | {
      id: string;
      type: 'generator';
      position: XYPosition;
      generatorId: string;
      width: number;
      height: number;
      params: Record<string, ParamValue>;
    }
  | {
      id: string;
      type: 'effect';
      position: XYPosition;
      effectId: string;
      params: Record<string, ParamValue>;
    }
  | {
      id: string;
      type: 'modulator';
      position: XYPosition;
      modulatorId: string;
      params: Record<string, ParamValue>;
      helperFor?: string;
    }
  | {
      id: string;
      type: 'render';
      position: XYPosition;
      format: ExportFormat;
      quality: number;
      scale: number;
      time: number;
      duration: number;
      fps: number;
      loopPreview?: boolean;
    }
  | {
      id: string;
      type: 'export';
      position: XYPosition;
      filenamePrefix?: string;
    }
  | {
      id: string;
      type: 'backgroundOutput';
      position: XYPosition;
      enabled?: boolean;
      fit?: 'fill' | 'fit' | 'cover' | 'contain';
      opacity?: number;
    }
  | { id: string; type: 'renderOutput'; position: XYPosition; width: number }
  | {
      id: string;
      type: 'moduleGroup';
      position: XYPosition;
      name: string;
      members: string[];
      inputs: GroupPort[];
      outputs: GroupPort[];
    };

/** Ports are named only where they are not the main one. */
type SerializedEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
};

export type SerializedGraph = {
  version: number;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
};

export const serializeGraph = (nodes: AppNode[], edges: Edge[]): SerializedGraph => ({
  version: DOCUMENT_VERSION,
  nodes: nodes.map((node): SerializedNode => {
    const position = { x: node.position.x, y: node.position.y };
    if (node.type === 'moduleGroup') {
      return {
        id: node.id,
        type: 'moduleGroup',
        position,
        name: node.data.name,
        members: node.data.members,
        inputs: node.data.inputs,
        outputs: node.data.outputs,
      };
    }
    if (node.type === 'image') {
      return {
        id: node.id,
        type: 'image',
        position,
        name: node.data.name,
        width: node.data.width,
        height: node.data.height,
      };
    }
    if (node.type === 'video') {
      return {
        id: node.id,
        type: 'video',
        position,
        name: node.data.name,
        width: node.data.width,
        height: node.data.height,
        duration: node.data.duration,
        speed: node.data.speed,
        loop: node.data.loop,
        muted: node.data.muted,
        playbackRate: node.data.playbackRate,
      };
    }
    if (node.type === 'generator') {
      return {
        id: node.id,
        type: 'generator',
        position,
        generatorId: node.data.generatorId,
        width: node.data.width,
        height: node.data.height,
        params: node.data.params,
      };
    }
    if (node.type === 'effect') {
      return {
        id: node.id,
        type: 'effect',
        position,
        effectId: node.data.effectId,
        params: node.data.params,
      };
    }
    if (node.type === 'modulator') {
      return {
        id: node.id,
        type: 'modulator',
        position,
        modulatorId: node.data.modulatorId,
        params: node.data.params,
        ...(node.data.helperFor ? { helperFor: node.data.helperFor } : {}),
      };
    }
    if (node.type === 'render') {
      return {
        id: node.id,
        type: 'render',
        position,
        format: node.data.format,
        quality: node.data.quality,
        scale: node.data.scale,
        time: node.data.time,
        duration: node.data.duration,
        fps: node.data.fps,
        loopPreview: node.data.loopPreview,
      };
    }
    if (node.type === 'export') {
      return {
        id: node.id,
        type: 'export',
        position,
        filenamePrefix: node.data.filenamePrefix,
      };
    }
    if (node.type === 'backgroundOutput') {
      return {
        id: node.id,
        type: 'backgroundOutput',
        position,
        enabled: node.data.enabled,
        fit: node.data.fit,
        opacity: node.data.opacity,
      };
    }
    return { id: node.id, type: 'renderOutput', position, width: node.data.width };
  }),
  edges: edges.map((edge) => {
    const saved: SerializedEdge = { id: edge.id, source: edge.source, target: edge.target };
    if (edge.sourceHandle) saved.sourceHandle = edge.sourceHandle;
    if (edge.targetHandle) saved.targetHandle = edge.targetHandle;
    return saved;
  }),
});

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isTuple = (value: unknown, length: number): boolean =>
  Array.isArray(value) && value.length === length && value.every(isNumber);

const isPosition = (value: unknown): value is XYPosition =>
  !!value && isNumber((value as XYPosition).x) && isNumber((value as XYPosition).y);

/** Whether a stored value is still the right shape for the spec it belongs to. */
const valueFits = (spec: ParamSpec, value: unknown): boolean => {
  switch (spec.kind) {
    case 'float':
    case 'int':
    case 'enum':
      return isNumber(value);
    case 'bool':
      return typeof value === 'boolean';
    case 'color':
      return isTuple(value, 3);
    case 'vec2':
      return isTuple(value, 2);
  }
};

/**
 * Saved parameters reconciled against what the module declares now.
 *
 * Start from the defaults and take back only the keys the module still has,
 * and only where the value is still the right shape. A module that gains a
 * knob, loses one, or renames one -- Trails swapping a decay multiplier for
 * a persistence in seconds, say -- then loads an old document without
 * either crashing or quietly feeding a stale number into a uniform that now
 * means something entirely different.
 */
const reconcileParams = (specs: ParamSpec[], saved: unknown): Record<string, ParamValue> => {
  const params: Record<string, ParamValue> = {};
  for (const spec of specs) params[spec.key] = spec.default;
  if (!saved || typeof saved !== 'object') return params;
  const source = saved as Record<string, unknown>;
  for (const spec of specs) {
    const value = source[spec.key];
    if (valueFits(spec, value)) params[spec.key] = value as ParamValue;
  }
  return params;
};

const outputNode = (id: string, position: XYPosition, width: unknown): AppNode => ({
  id,
  type: 'renderOutput',
  position,
  data: { width: isNumber(width) ? width : DEFAULT_PREVIEW_WIDTH },
});

/** A positive finite number, or the fallback. */
const positive = (value: unknown, fallback: number): number => (isNumber(value) && value > 0 ? value : fallback);

/** A generator's pixel size: a positive whole number within what a texture can be. */
const pixelSize = (value: unknown, fallback: number): number =>
  isNumber(value) && value > 0 ? Math.min(MAX_GENERATOR_SIZE, Math.max(1, Math.round(value))) : fallback;

const videoSpeed = (value: unknown): number =>
  isNumber(value) && value > 0 ? Math.min(MAX_VIDEO_SPEED, Math.max(MIN_VIDEO_SPEED, value)) : 1;

const RENDER_FORMATS: ExportFormat[] = ['jpg', 'png', 'gif', 'mp4', 'webm'];

const PORT_KINDS: GroupPort['kind'][] = ['picture', 'param', 'field', 'mod'];

/** A group's saved ports, keeping only the well-formed ones. */
const readPorts = (value: unknown): GroupPort[] =>
  Array.isArray(value)
    ? value.flatMap((port: Partial<GroupPort> | null): GroupPort[] =>
        port &&
        typeof port.node === 'string' &&
        (port.handle === null || typeof port.handle === 'string') &&
        typeof port.label === 'string' &&
        PORT_KINDS.includes(port.kind as GroupPort['kind'])
          ? [{ node: port.node, handle: port.handle, label: port.label, kind: port.kind as GroupPort['kind'] }]
          : [],
      )
    : [];

/**
 * Rebuild a graph from a parsed document, or null if it is not one.
 *
 * Every field is checked rather than trusted. This reads whatever is in
 * local storage, which may have been written by an older build, hand-edited,
 * or truncated by a browser reclaiming space -- and a malformed document
 * should give a fresh editor, never a broken one.
 */
export const deserializeGraph = (raw: unknown): { nodes: AppNode[]; edges: Edge[] } | null => {
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Partial<SerializedGraph>;
  if (typeof doc.version !== 'number' || !READABLE_VERSIONS.has(doc.version)) return null;
  if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return null;

  const nodes: AppNode[] = [];
  // Two nodes under one id would be one node to the graph and the renderer,
  // and there is no telling which one a wire meant. The first is kept.
  const taken = new Set<string>();
  for (const entry of doc.nodes) {
    if (!entry || typeof entry.id !== 'string' || !isPosition(entry.position)) continue;
    if (taken.has(entry.id)) continue;
    const before = nodes.length;
    const position = { x: entry.position.x, y: entry.position.y };
    // Read as a plain string: 'formatter' is no longer a type a document
    // can name, only one an old document might.
    const type = entry.type as string;

    if (entry.type === 'image') {
      nodes.push({
        id: entry.id,
        type: 'image',
        position,
        // No bitmap survives a reload, so the node comes back empty and
        // names what it is missing.
        data: {
          src: null,
          name: typeof entry.name === 'string' ? entry.name : '',
          width: isNumber(entry.width) ? entry.width : 0,
          height: isNumber(entry.height) ? entry.height : 0,
        },
      });
    } else if (entry.type === 'video') {
      nodes.push({
        id: entry.id,
        type: 'video',
        position,
        data: {
          src: null,
          name: typeof entry.name === 'string' ? entry.name : '',
          width: isNumber(entry.width) ? entry.width : 0,
          height: isNumber(entry.height) ? entry.height : 0,
          duration: isNumber(entry.duration) && entry.duration >= 0 ? entry.duration : 0,
          speed: videoSpeed(entry.speed),
          loop: typeof entry.loop === 'boolean' ? entry.loop : true,
          muted: typeof entry.muted === 'boolean' ? entry.muted : true,
          playbackRate: videoSpeed(entry.playbackRate),
        },
      });
    } else if (entry.type === 'generator') {
      if (typeof entry.generatorId !== 'string') continue;
      const def = getGenerator(entry.generatorId) ?? getEffect(entry.generatorId);
      nodes.push({
        id: entry.id,
        type: 'generator',
        position,
        data: {
          generatorId: entry.generatorId,
          width: pixelSize(entry.width, 1280),
          height: pixelSize(entry.height, 720),
          // Unknown, it keeps its node but not its params -- the same as an
          // unknown effect, and for the same reason: nothing can say what
          // shape they should be.
          params: def ? reconcileParams(paramsOf(def), entry.params) : {},
        },
      });
    } else if (entry.type === 'effect') {
      if (typeof entry.effectId !== 'string') continue;
      const def = getEffect(entry.effectId);
      nodes.push({
        id: entry.id,
        type: 'effect',
        position,
        // An effect that no longer exists keeps its node rather than
        // vanishing and silently rewiring the chain around it; the card
        // renders as unknown and the user decides what to do about it.
        data: {
          effectId: entry.effectId,
          params: def ? reconcileParams(paramsOf(def), entry.params) : {},
        },
      });
    } else if (entry.type === 'modulator') {
      if (typeof entry.modulatorId !== 'string') continue;
      const def = getModulator(entry.modulatorId);
      // Kept when unknown, for the same reason as an unknown effect.
      nodes.push({
        id: entry.id,
        type: 'modulator',
        position,
        data: {
          modulatorId: entry.modulatorId,
          params: def ? reconcileParams(modulatorParamsOf(def), entry.params) : {},
          ...(typeof entry.helperFor === 'string' ? { helperFor: entry.helperFor } : {}),
        },
      });
    } else if (type === 'render' || type === 'formatter') {
      // 'formatter' is what the Render node was called before version 3.
      const saved = entry as Extract<SerializedNode, { type: 'render' }>;
      const format =
        typeof saved.format === 'string' && RENDER_FORMATS.includes(saved.format)
          ? saved.format
          : DEFAULT_RENDER_DATA.format;
      // Only the recipe is read: a baked file never belonged in the
      // document, and whatever an old build left beside it is ignored.
      nodes.push({
        id: entry.id,
        type: 'render',
        position,
        data: clampRenderData({
          format,
          quality: positive(saved.quality, DEFAULT_RENDER_DATA.quality),
          scale: positive(saved.scale, DEFAULT_RENDER_DATA.scale),
          time: isNumber(saved.time) && saved.time >= 0 ? saved.time : DEFAULT_RENDER_DATA.time,
          duration: positive(saved.duration, DEFAULT_RENDER_DATA.duration),
          fps: positive(saved.fps, DEFAULT_RENDER_DATA.fps),
          loopPreview:
            typeof saved.loopPreview === 'boolean' ? saved.loopPreview : DEFAULT_RENDER_DATA.loopPreview,
        }),
      });
    } else if (entry.type === 'export') {
      nodes.push({
        id: entry.id,
        type: 'export',
        position,
        data: {
          filenamePrefix: typeof entry.filenamePrefix === 'string' ? entry.filenamePrefix : '',
        },
      });
    } else if (entry.type === 'backgroundOutput') {
      const fit = entry.fit === 'fit' || entry.fit === 'contain' ? 'fit' : 'fill';
      nodes.push({
        id: entry.id,
        type: 'backgroundOutput',
        position,
        data: {
          enabled: typeof entry.enabled === 'boolean' ? entry.enabled : DEFAULT_BACKGROUND_DATA.enabled,
          fit,
          opacity: isNumber(entry.opacity) ? Math.min(1, Math.max(0, entry.opacity)) : DEFAULT_BACKGROUND_DATA.opacity,
        },
      });
    } else if (entry.type === 'renderOutput') {
      nodes.push(outputNode(entry.id, position, entry.width));
    } else if (entry.type === 'moduleGroup') {
      nodes.push({
        id: entry.id,
        type: 'moduleGroup',
        position,
        // Checked against the members once every node is in (below).
        data: {
          name: typeof entry.name === 'string' ? entry.name : 'Group',
          members: Array.isArray(entry.members) ? entry.members.filter((id) => typeof id === 'string') : [],
          inputs: readPorts(entry.inputs),
          outputs: readPorts(entry.outputs),
        },
      });
    }

    if (nodes.length > before) taken.add(entry.id);
  }

  // A group holds modules that are here, that a group may hold, and that no
  // other group already has; one left with fewer than two is not a group
  // any more, and its members load loose. Members are hidden behind it.
  const claimed = new Set<string>();
  const loaded = new Map(nodes.map((node) => [node.id, node]));
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const group = nodes[i];
    if (group.type !== 'moduleGroup') continue;
    const members = group.data.members.filter((id) => {
      const member = loaded.get(id);
      return !!member && canJoinGroup(member) && !claimed.has(id);
    });
    if (members.length < 2) {
      nodes.splice(i, 1);
      continue;
    }
    const inside = new Set(members);
    group.data.members = members;
    group.data.inputs = group.data.inputs.filter((port) => inside.has(port.node));
    group.data.outputs = group.data.outputs.filter((port) => inside.has(port.node));
    for (const id of members) {
      claimed.add(id);
      loaded.get(id)!.hidden = true;
    }
  }

  // A document with no viewer is left with none. There can be several, and
  // deleting them all is a deliberate act -- the Output menu puts one back.

  const byId = new Map(nodes.map((node) => [node.id, node]));

  // A helper's mark only means something while the video it names is here.
  for (const node of nodes) {
    if (node.type === 'modulator' && node.data.helperFor && byId.get(node.data.helperFor)?.type !== 'video') {
      delete node.data.helperFor;
    }
  }

  const edges: Edge[] = [];
  const edgeIds = new Set<string>();
  for (const entry of doc.edges) {
    if (!entry || typeof entry.id !== 'string' || edgeIds.has(entry.id)) continue;
    // A wire to a node that did not survive would be a link to nothing.
    const target = byId.get(entry.target);
    if (!byId.has(entry.source) || !target) continue;
    const sourceHandle = typeof entry.sourceHandle === 'string' ? entry.sourceHandle : null;
    const targetHandle = typeof entry.targetHandle === 'string' ? entry.targetHandle : null;
    // Nor would one into a port the module no longer has -- a param that
    // was renamed, an input that was taken away.
    if (!hasTargetPort(target, targetHandle)) continue;
    // An input takes one wire; a second into the same port is dropped.
    if (edges.some((edge) => edge.target === entry.target && samePort(edge.targetHandle, targetHandle))) continue;
    const edge: Edge = { id: entry.id, source: entry.source, target: entry.target, sourceHandle, targetHandle, type: 'link' };
    // Nor is a wire that closes a loop. Builds before the editor refused
    // them could save one -- two viewers fed into each other -- and every
    // reload then went round it forever. The wire that closes the loop is
    // the one dropped, and the rest of the document loads.
    if (wouldCreateCycle(edges, edge)) continue;
    edgeIds.add(entry.id);
    edges.push(edge);
  }

  // Then the same rules the editor applies when a wire is drawn -- a baked
  // file into an effect, a live picture into an exporter. Checked against
  // the whole set rather than in file order, since whether a wire carries a
  // baked file depends on the wires upstream of it.
  const valid = edges.filter((edge) => isValidConnection(nodes, edges, edge));

  return { nodes, edges: valid };
};

/**
 * The largest trailing number across a set of ids.
 *
 * Fresh ids are minted from a counter that starts at zero each session. After
 * restoring a document that counter has to be moved past everything already
 * in use, or the next node added would be handed an id a restored one is
 * holding, and the two would be the same node as far as the graph, the
 * renderer and the feedback buffers are concerned.
 */
export const highestIdSuffix = (ids: string[]): number => {
  let highest = 0;
  for (const id of ids) {
    const match = /-(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest;
};

const STORAGE_KEY = 'comp.graph';

/*
 * Set when the saved document was written by a newer build than this one.
 *
 * This build cannot read it, and it opens on a fresh graph -- but it must
 * not autosave that fresh graph over the newer work, which is what used to
 * happen: an old tab left open, or a cached build, would quietly wipe the
 * document the moment anything changed. So for the rest of the session
 * nothing is written. Losing this session's edits on close is the lesser
 * surprise: the document the user actually made is still there when they
 * reopen the current build.
 */
let newerDocumentOnDisk = false;

/** Whether autosave is off because the stored document is newer than this build. */
export const autosaveBlocked = (): boolean => newerDocumentOnDisk;

export const saveGraph = (nodes: AppNode[], edges: Edge[]): void => {
  if (newerDocumentOnDisk) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeGraph(nodes, edges)));
  } catch {
    // Private windows refuse storage outright and a full quota throws too.
    // Neither is worth interrupting the session over; the graph is still
    // perfectly usable, it just will not outlive the tab.
  }
};

export const loadGraph = (): { nodes: AppNode[]; edges: Edge[] } | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const version = (parsed as Partial<SerializedGraph> | null)?.version;
    if (typeof version === 'number' && version > DOCUMENT_VERSION) {
      newerDocumentOnDisk = true;
      console.warn(
        `The saved document is version ${version}; this build reads up to ${DOCUMENT_VERSION}. ` +
          'It has been left untouched, and changes made here will not be saved.',
      );
      return null;
    }
    return deserializeGraph(parsed);
  } catch {
    return null;
  }
};
