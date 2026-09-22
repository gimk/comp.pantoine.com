import type { Edge, Node } from '@xyflow/react';
import { getEffect } from '../engine/registry';
import { isAnimated, type ParamValue } from '../engine/effects';
import { getImage } from '../engine/imageStore';
import type { Pass } from '../engine/pipeline';

export type ImageNodeData = {
  /** Object URL for the thumbnail, or null while the node is still empty. */
  src: string | null;
  name: string;
  width: number;
  height: number;
};

export type EffectNodeData = {
  effectId: string;
  params: Record<string, ParamValue>;
};

export type OutputNodeData = {
  /**
   * Preview width in graph units. The height is not stored: it follows the
   * image's own ratio, so there is only ever one number to keep.
   */
  width: number;
};

export type AppNode =
  | Node<ImageNodeData, 'image'>
  | Node<EffectNodeData, 'effect'>
  | Node<OutputNodeData, 'renderOutput'>;

/** Starting width of the output preview, in graph units. */
export const DEFAULT_PREVIEW_WIDTH = 360;

/**
 * A stable per-node random, derived from the node id (FNV-1a).
 *
 * Noise-based modules offset their field by this, so two Grain nodes in one
 * chain lay down different dirt rather than the same pattern twice. Derived
 * rather than stored because it then survives a reload for free, once the
 * graph is something that can be reloaded.
 */
const seedFor = (id: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
};

export type ResolvedChain = {
  sourceNodeId: string;
  passes: Pass[];
};

/**
 * Walk backwards from the Output node to the image feeding it.
 *
 * Returns null whenever the graph cannot produce a picture -- nothing wired
 * to the output, a dangling effect, or an image node with no image loaded.
 * The render view treats that as its empty state rather than an error, since
 * it is the normal condition while the user is still wiring things up.
 */
export const resolveChain = (
  nodes: AppNode[],
  edges: Edge[],
  outputNodeId: string,
): ResolvedChain | null => {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // Inputs accept a single edge, so one source per target is the whole story.
  const incoming = new Map<string, string>();
  for (const edge of edges) incoming.set(edge.target, edge.source);

  // Resolved for one named viewer rather than "the" viewer: there can be
  // several, each watching a different branch of the graph.
  const output = nodes.find((node) => node.id === outputNodeId && node.type === 'renderOutput');
  if (!output) return null;

  // Collected output-first, so the chain comes out reversed.
  const reversed: Pass[] = [];
  const seen = new Set<string>();
  let cursor = incoming.get(output.id);

  while (cursor !== undefined) {
    // A user can wire a loop; refusing to follow it twice keeps the walk
    // finite instead of hanging the renderer.
    if (seen.has(cursor)) return null;
    seen.add(cursor);

    const node = byId.get(cursor);
    if (!node) return null;

    if (node.type === 'image') {
      if (!getImage(node.id)) return null;
      reversed.reverse();
      return { sourceNodeId: node.id, passes: reversed };
    }

    if (node.type === 'effect') {
      const def = getEffect(node.data.effectId);
      if (!def) return null;
      reversed.push({ nodeId: node.id, seed: seedFor(node.id), def, params: node.data.params });
      cursor = incoming.get(node.id);
      continue;
    }

    if (node.type === 'renderOutput') {
      // A viewer part-way along a chain is a tap, not a stage: it shows what
      // has reached it and passes the picture on untouched. Several strung
      // together is how you watch the same edit at different points.
      cursor = incoming.get(node.id);
      continue;
    }

    return null;
  }

  return null;
};

/** Whether anything in the chain needs a continuous frame loop. */
export const chainIsAnimated = (chain: ResolvedChain | null): boolean =>
  chain !== null && chain.passes.some((pass) => isAnimated(pass.def, pass.params));
