/**
 * Which wires the graph will take.
 *
 * Pure, so the canvas can ask while a wire is still being dragged, the store
 * can refuse one made any other way, and the loader can apply the same rules
 * to a document it did not write.
 */
import type { Connection, Edge } from '@xyflow/react';
import { getModulator } from '../engine/modulators';
import {
  MOD_OUTPUT,
  carriesRenderAsset,
  isParamPort,
  isRenderPort,
  portTakesField,
  samePort,
  type AppNode,
} from './graph';

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
 * What goes where, following Blender's sockets: pictures into picture
 * inputs, and into any param port shaped as a diamond, where they become a
 * field; signals into any param port, and into a picture input as a flat
 * grey; rendered media assets into render ports only. Never in a loop.
 *
 * A Math or Map Range is a signal or a field depending on what feeds it,
 * which can change after it is wired. A field reaching a round port is
 * allowed and drawn red rather than refused, as Blender leaves an invalid
 * link in place -- otherwise rewiring upstream would silently cut wires
 * downstream, and a document would lose them on reload.
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
  const sourceIsAsset = () => isRenderPort(wire.sourceHandle) || carriesRenderAsset(nodes, edges, sourceNode.id);

  let allowed: boolean;
  if (isTargetMod) {
    // A signal into any param; a live picture only where it can be a field.
    allowed = isSourceMod || (!sourceIsAsset() && portTakesField(targetNode, wire.targetHandle));
  } else if (isSourceMod) {
    // A signal or a field where a picture goes: an effect's inputs, a
    // viewer, a Render, or an Image Statistic -- never a baked-file port.
    allowed =
      !isRenderPort(wire.targetHandle) &&
      (targetNode.type === 'effect' ||
        targetNode.type === 'renderOutput' ||
        targetNode.type === 'backgroundOutput' ||
        targetNode.type === 'render' ||
        (targetNode.type === 'modulator' && !wire.targetHandle && !!getModulator(targetNode.data.modulatorId)?.picture));
  } else if (targetNode.type === 'modulator') {
    // A picture into an Image Statistic's input.
    allowed = !wire.targetHandle && !!getModulator(targetNode.data.modulatorId)?.picture && !sourceIsAsset();
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
