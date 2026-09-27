/**
 * Which wires the graph will take.
 *
 * Pure, so the canvas can ask while a wire is still being dragged, the store
 * can refuse one made any other way, and the loader can apply the same rules
 * to a document it did not write.
 */
import type { Connection, Edge } from '@xyflow/react';
import { MOD_OUTPUT, carriesRenderAsset, isParamPort, isRenderPort, samePort, type AppNode } from './graph';

/** Either end of a prospective wire: a Connection, or an Edge being moved. */
type Wire = Pick<Connection, 'source' | 'target'> & {
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

/**
 * Whether `target` can already reach `source` along existing wires -- in
 * which case a wire from `source` to `target` would close a loop.
 *
 * Wires into the port the new one lands on are left out: an input takes a
 * single wire, so whatever is there now is about to be replaced.
 */
export const wouldCreateCycle = (edges: Edge[], wire: Wire): boolean => {
  if (wire.source === wire.target) return true;
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.target === wire.target && samePort(edge.targetHandle, wire.targetHandle)) continue;
    const next = outgoing.get(edge.source);
    if (next) next.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }
  const seen = new Set<string>();
  const pending = [wire.target];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (id === wire.source) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of outgoing.get(id) ?? []) pending.push(next);
  }
  return false;
};

/**
 * Pictures go into picture inputs, signals into param ports, and rendered
 * media assets into render ports -- never cross-wired, and never in a loop.
 *
 * A loop has no picture to show: the chain resolver gives up on one, and two
 * viewers wired into each other used to be enough to take the whole editor
 * down on every reload. Refusing it here means it never gets made.
 */
export const isValidConnection = (nodes: AppNode[], edges: Edge[], wire: Wire): boolean => {
  if (!wire.source || !wire.target || wire.source === wire.target) return false;

  const sourceNode = nodes.find((n) => n.id === wire.source);
  const targetNode = nodes.find((n) => n.id === wire.target);
  if (!sourceNode || !targetNode) return false;

  const isSourceMod = wire.sourceHandle === MOD_OUTPUT || sourceNode.type === 'modulator';
  const isTargetMod = isParamPort(wire.targetHandle);

  let allowed: boolean;
  if (isSourceMod || isTargetMod) {
    // Modulation signals can only connect to modulation param ports.
    allowed = isSourceMod && isTargetMod;
  } else {
    // Whether the source stream is a rendered asset (purple) or a live picture (blue).
    const isSourceRender = isRenderPort(wire.sourceHandle) || carriesRenderAsset(nodes, edges, sourceNode.id);
    if (targetNode.type === 'renderOutput' || targetNode.type === 'backgroundOutput') {
      // A viewer or background shows either.
      allowed = true;
    } else if (targetNode.type === 'export' || isRenderPort(wire.targetHandle)) {
      // An exporter only takes something already baked.
      allowed = isSourceRender;
    } else {
      // Everything else -- effects, the Render node itself -- works on live pictures.
      allowed = !isSourceRender;
    }
  }

  return allowed && !wouldCreateCycle(edges, wire);
};
