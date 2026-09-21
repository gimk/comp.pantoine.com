import type { Edge, Node } from '@xyflow/react';
import { getEffect } from '../engine/registry';
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
  params: Record<string, number>;
};

export type OutputNodeData = {
  /** Present so the type is a distinct object shape, not an empty one. */
  label: string;
};

export type AppNode =
  | Node<ImageNodeData, 'image'>
  | Node<EffectNodeData, 'effect'>
  | Node<OutputNodeData, 'renderOutput'>;

export const OUTPUT_NODE_ID = 'output';

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
export const resolveChain = (nodes: AppNode[], edges: Edge[]): ResolvedChain | null => {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // Inputs accept a single edge, so one source per target is the whole story.
  const incoming = new Map<string, string>();
  for (const edge of edges) incoming.set(edge.target, edge.source);

  const output = nodes.find((node) => node.type === 'renderOutput');
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
      reversed.push({ def, params: node.data.params });
      cursor = incoming.get(node.id);
      continue;
    }

    return null;
  }

  return null;
};

/** Whether anything in the chain needs a continuous frame loop. */
export const chainIsAnimated = (chain: ResolvedChain | null): boolean =>
  chain !== null && chain.passes.some((pass) => pass.def.animated);
