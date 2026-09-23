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
import { getModulator, modulatorParamsOf } from '../engine/modulators';
import { DEFAULT_PREVIEW_WIDTH, hasTargetPort, type AppNode } from './graph';

/**
 * Bumped when the shape changes in a way older documents cannot satisfy.
 *
 * 2 added modulator nodes and named ports on edges. A version 1 document
 * is still read: it has neither, and without them it means exactly what it
 * meant before -- every wire into the one input a node had. A version 2
 * document is not readable by a build that only knows 1, which is what the
 * number is for.
 */
export const DOCUMENT_VERSION = 2;

/** Older versions this build still reads as they are. */
const READABLE_VERSIONS = new Set([1, DOCUMENT_VERSION]);

type SerializedNode =
  | { id: string; type: 'image'; position: XYPosition; name: string; width: number; height: number }
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
    }
  | { id: string; type: 'renderOutput'; position: XYPosition; width: number };

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
  for (const entry of doc.nodes) {
    if (!entry || typeof entry.id !== 'string' || !isPosition(entry.position)) continue;
    const position = { x: entry.position.x, y: entry.position.y };

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
      continue;
    }

    if (entry.type === 'effect') {
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
      continue;
    }

    if (entry.type === 'modulator') {
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
        },
      });
      continue;
    }

    if (entry.type === 'renderOutput') nodes.push(outputNode(entry.id, position, entry.width));
  }

  // A document with no viewer is left with none. There can be several, and
  // deleting them all is a deliberate act -- the Output menu puts one back.

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: Edge[] = [];
  for (const entry of doc.edges) {
    if (!entry || typeof entry.id !== 'string') continue;
    // A wire to a node that did not survive would be a link to nothing.
    const target = byId.get(entry.target);
    if (!byId.has(entry.source) || !target) continue;
    const sourceHandle = typeof entry.sourceHandle === 'string' ? entry.sourceHandle : null;
    const targetHandle = typeof entry.targetHandle === 'string' ? entry.targetHandle : null;
    // Nor would one into a port the module no longer has -- a param that
    // was renamed, an input that was taken away.
    if (!hasTargetPort(target, targetHandle)) continue;
    edges.push({ id: entry.id, source: entry.source, target: entry.target, sourceHandle, targetHandle, type: 'link' });
  }

  return { nodes, edges };
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

export const saveGraph = (nodes: AppNode[], edges: Edge[]): void => {
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
    return raw ? deserializeGraph(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};
