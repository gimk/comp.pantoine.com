import type { Edge, Node } from '@xyflow/react';
import { getEffect } from '../engine/registry';
import { inputsOf, isAnimated, paramsOf, type ParamValue } from '../engine/effects';
import {
  getModulator,
  isModulatable,
  modulatorPortsOf,
  signalIsMoving,
  type Signal,
} from '../engine/modulators';
import { getImage } from '../engine/imageStore';
import type { Pass, RenderPlan, Step } from '../engine/pipeline';

export type ImageNodeData = {
  /** Object URL for the thumbnail, or null while the node is still empty. */
  src: string | null;
  name: string;
  width: number;
  height: number;
  /** Error message if decoding or loading failed. */
  error?: string | null;
};

export type EffectNodeData = {
  effectId: string;
  params: Record<string, ParamValue>;
};

export type ModulatorNodeData = {
  modulatorId: string;
  params: Record<string, ParamValue>;
};

export type OutputNodeData = {
  /**
   * Preview width in graph units. The height is not stored: it follows the
   * image's own ratio, so there is only ever one number to keep.
   */
  width: number;
};

export type ExportFormat = 'png' | 'jpg' | 'gif' | 'mp4' | 'webm';

export type RenderNodeData = {
  format: ExportFormat;
  quality: number;
  scale: number;
  time: number;
  duration: number;
  fps: number;
  loopPreview?: boolean;
  renderedBlob?: Blob | null;
  renderedUrl?: string | null;
  renderedSize?: number | null;
  renderedDimensions?: { width: number; height: number } | null;
  rendering?: boolean;
  progress?: { currentFrame: number; totalFrames: number; percent: number } | null;
  error?: string | null;
};

export const DEFAULT_RENDER_DATA: RenderNodeData = {
  format: 'mp4',
  quality: 0.9,
  scale: 1,
  time: 0,
  duration: 3,
  fps: 30,
  loopPreview: true,
};

export type FormatterNodeData = RenderNodeData;
export const DEFAULT_FORMATTER_DATA: FormatterNodeData = DEFAULT_RENDER_DATA;

export type ExportNodeData = {
  filenamePrefix: string;
};

export const DEFAULT_EXPORT_DATA: ExportNodeData = {
  filenamePrefix: '',
};

export type AppNode =
  | Node<ImageNodeData, 'image'>
  | Node<EffectNodeData, 'effect'>
  | Node<ModulatorNodeData, 'modulator'>
  | Node<OutputNodeData, 'renderOutput'>
  | Node<RenderNodeData, 'render'>
  | Node<FormatterNodeData, 'formatter'>
  | Node<ExportNodeData, 'export'>;

/** Starting width of the output preview, in graph units. */
export const DEFAULT_PREVIEW_WIDTH = 360;

/*
 * Ports.
 *
 * The main image input has no handle id -- it is the one every node with an
 * input has always had, and an edge that names no target handle means it.
 * Keeping it that way is what lets documents saved before there was more
 * than one input load unchanged. Everything added since is named: an
 * effect's extra inputs by their key, a param's modulation port by
 * `param:<key>`, a modulator's output as `mod`, and a rendered media file as `render`.
 */
export const MOD_OUTPUT = 'mod';
export const RENDER_PORT = 'render';
const PARAM_PORT_PREFIX = 'param:';

export const paramPort = (key: string): string => PARAM_PORT_PREFIX + key;

export const isParamPort = (handle: string | null | undefined): handle is string =>
  !!handle && handle.startsWith(PARAM_PORT_PREFIX);

export const isRenderPort = (handle: string | null | undefined): boolean =>
  handle === RENDER_PORT;

/** A wire carrying a modulator's signal rather than a picture. */
export const isModulationEdge = (edge: Pick<Edge, 'targetHandle'>): boolean =>
  isParamPort(edge.targetHandle);

/** A wire carrying a baked/rendered file asset. */
export const isRenderEdge = (edge: Pick<Edge, 'sourceHandle' | 'targetHandle'>): boolean =>
  isRenderPort(edge.sourceHandle) || isRenderPort(edge.targetHandle);

/**
 * Walk backwards along purple edges through any intermediate pass-through viewers
 * to locate the upstream Render node producing the asset.
 */
export const findUpstreamRenderNode = (
  nodes: AppNode[],
  edges: Edge[],
  startNodeId: string,
): Node<RenderNodeData, 'render'> | null => {
  let currentId: string | undefined = startNodeId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const inEdges = edges.filter((e) => e.target === currentId);
    if (inEdges.length === 0) return null;

    const inEdge = inEdges.find((e) => {
      if (isRenderPort(e.targetHandle) || isRenderPort(e.sourceHandle)) return true;
      const src = nodes.find((n) => n.id === e.source);
      if (src?.type === 'render' || src?.type === 'formatter') return true;
      if (src?.type === 'renderOutput') {
        return !!findUpstreamRenderNode(nodes, edges, src.id);
      }
      return false;
    });

    if (!inEdge) return null;
    const srcNode = nodes.find((n) => n.id === inEdge.source);
    if (!srcNode) return null;
    if (srcNode.type === 'render' || srcNode.type === 'formatter') {
      return srcNode as Node<RenderNodeData, 'render'>;
    }
    if (srcNode.type === 'renderOutput') {
      currentId = srcNode.id;
      continue;
    }
    return null;
  }
  return null;
};

/** Whether two ends name the same input port. Null and undefined both mean the main one. */
export const samePort = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? null) === (b ?? null);

/**
 * Whether a node has an input port by this id -- so a saved wire into a
 * port the module no longer has can be dropped on load rather than left
 * pointing at nothing.
 */
export const hasTargetPort = (node: AppNode, handle: string | null | undefined): boolean => {
  if (node.type === 'renderOutput') {
    return !handle || isRenderPort(handle);
  }
  if (node.type === 'export') {
    return isRenderPort(handle);
  }
  if (node.type === 'render' || node.type === 'formatter') {
    return !handle;
  }
  if (node.type === 'modulator') {
    const def = getModulator(node.data.modulatorId);
    return !!def && isParamPort(handle) && modulatorPortsOf(def).includes(handle.slice(PARAM_PORT_PREFIX.length));
  }
  if (node.type !== 'effect') return false;
  if (!handle) return true;
  const def = getEffect(node.data.effectId);
  if (!def) return false;
  if (isParamPort(handle)) {
    const key = handle.slice(PARAM_PORT_PREFIX.length);
    return paramsOf(def).some((spec) => spec.key === key && isModulatable(spec));
  }
  return inputsOf(def).some((input) => input.key === handle);
};

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

/**
 * Nodes standing in for another for the length of an Alt-drag.
 *
 * The copy left behind is minted with a fresh id, but until the drop swaps
 * the two back it is the original as far as the picture is concerned -- so
 * it renders with the original's seed and feedback history, and the grain
 * does not jump for the duration of the drag.
 */
export const identityAliases = new Map<string, string>();

const identityOf = (id: string): string => identityAliases.get(id) ?? id;

/** Each port takes a single wire, so a port names exactly one source. */
type PortIndex = (nodeId: string, handle: string | null) => string | undefined;

const indexPorts = (edges: Edge[]): PortIndex => {
  const incoming = new Map<string, Map<string | null, string>>();
  for (const edge of edges) {
    let ports = incoming.get(edge.target);
    if (!ports) incoming.set(edge.target, (ports = new Map()));
    ports.set(edge.targetHandle ?? null, edge.source);
  }
  return (nodeId, handle) => incoming.get(nodeId)?.get(handle);
};

/**
 * The signal a modulator node puts out, with everything wired into its
 * ports resolved behind it.
 *
 * A loop among modulators -- two Maths feeding each other -- is cut where
 * it closes: the port that would complete it is treated as unwired. Unlike
 * a loop in the picture path, there is still a sensible answer without it,
 * so there is no reason to blank the viewer.
 */
const signalFrom = (
  byId: Map<string, AppNode>,
  sourceOf: PortIndex,
  nodeId: string | undefined,
  visiting: Set<string>,
): Signal | null => {
  if (nodeId === undefined || visiting.has(nodeId)) return null;
  const node = byId.get(nodeId);
  if (!node || node.type !== 'modulator') return null;
  const def = getModulator(node.data.modulatorId);
  if (!def) return null;

  visiting.add(nodeId);
  const inputs: Record<string, Signal> = {};
  for (const key of modulatorPortsOf(def)) {
    const input = signalFrom(byId, sourceOf, sourceOf(nodeId, paramPort(key)), visiting);
    if (input) inputs[key] = input;
  }
  visiting.delete(nodeId);

  return { def, params: node.data.params, seed: seedFor(identityOf(node.id)), inputs };
};

/** What one modulator node puts out, for its card to draw. */
export const resolveSignal = (nodes: AppNode[], edges: Edge[], nodeId: string): Signal | null =>
  signalFrom(new Map(nodes.map((node) => [node.id, node])), indexPorts(edges), nodeId, new Set());

export type ResolvedChain = {
  /** The image at the head of the main input path; it sets the frame. */
  sourceNodeId: string;
  plan: RenderPlan;
  /** Every effect in the plan, in run order. */
  passes: Pass[];
  /** The recipe from the nearest upstream formatter node, if any. */
  formatter?: FormatterNodeData;
};

/** Thrown to abandon a walk that has come back round to where it started. */
class Loop extends Error {}

/**
 * Work out what one viewer has to draw, as a list of steps in run order.
 *
 * Walks backwards from the viewer along every input, depth first, and
 * emits each node after the ones it reads -- so the list can be run front
 * to back. A node reached twice, as when one picture feeds both sides of a
 * Blend, is emitted once and read twice.
 *
 * Returns null whenever the graph cannot produce a picture -- nothing wired
 * to the viewer, an effect with nothing on its main input, or an image node
 * with no image loaded on the main path. The render view treats that as its
 * empty state rather than an error, since it is the normal condition while
 * the user is still wiring things up. An extra input that cannot produce a
 * picture is not fatal: it samples as transparent, and the effect carries
 * on without it.
 */
export const resolveChain = (
  nodes: AppNode[],
  edges: Edge[],
  outputNodeId: string,
): ResolvedChain | null => {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const sourceOf = indexPorts(edges);

  // Resolved for one named viewer rather than "the" viewer: there can be
  // several, each watching a different branch of the graph.
  const output = byId.get(outputNodeId);
  if (
    !output ||
    (output.type !== 'renderOutput' &&
      output.type !== 'export' &&
      output.type !== 'render' &&
      output.type !== 'formatter')
  ) {
    return null;
  }

  let activeFormatter: RenderNodeData | undefined =
    output.type === 'render' || output.type === 'formatter' ? output.data : undefined;

  const steps: Step[] = [];
  const done = new Map<string, number | null>();
  const visiting = new Set<string>();

  const modulationFor = (nodeId: string, specs: ReturnType<typeof paramsOf>): Record<string, Signal> => {
    const modulation: Record<string, Signal> = {};
    for (const spec of specs) {
      if (!isModulatable(spec)) continue;
      const signal = signalFrom(byId, sourceOf, sourceOf(nodeId, paramPort(spec.key)), new Set());
      if (signal) modulation[spec.key] = signal;
    }
    return modulation;
  };

  /** The step index for a node's picture, or null if it cannot make one. */
  const visit = (nodeId: string | undefined): number | null => {
    if (nodeId === undefined) return null;
    if (done.has(nodeId)) return done.get(nodeId)!;
    // A user can wire a loop; refusing to follow it keeps the walk finite
    // instead of hanging the renderer.
    if (visiting.has(nodeId)) throw new Loop();
    visiting.add(nodeId);

    const node = byId.get(nodeId);
    let index: number | null = null;

    if (node?.type === 'image') {
      if (getImage(node.id)) index = steps.push({ kind: 'image', nodeId: node.id }) - 1;
    } else if (
      node?.type === 'renderOutput' ||
      node?.type === 'export' ||
      node?.type === 'render' ||
      node?.type === 'formatter'
    ) {
      if ((node?.type === 'render' || node?.type === 'formatter') && !activeFormatter) {
        activeFormatter = node.data;
      }
      // A viewer, exporter, or render part-way along a chain is a tap, not a stage: it shows what
      // has reached it and passes the picture on untouched. Several strung
      // together is how you watch the same edit at different points.
      index = visit(sourceOf(node.id, null));
    } else if (node?.type === 'effect') {
      const def = getEffect(node.data.effectId);
      const input = def ? visit(sourceOf(node.id, null)) : null;
      if (def && input !== null) {
        const extras = inputsOf(def).map((spec) => visit(sourceOf(node.id, spec.key)));
        const identity = identityOf(node.id);
        const pass: Pass = {
          nodeId: identity,
          seed: seedFor(identity),
          def,
          params: node.data.params,
          modulation: modulationFor(node.id, paramsOf(def)),
        };
        index = steps.push({ kind: 'effect', pass, input, extras }) - 1;
      }
    }

    visiting.delete(nodeId);
    done.set(nodeId, index);
    return index;
  };

  let outputIndex: number | null;
  try {
    outputIndex = visit(sourceOf(output.id, null));
  } catch (error) {
    if (error instanceof Loop) return null;
    throw error;
  }
  if (outputIndex === null) return null;

  // Follow main inputs back up to the image that sets the frame.
  let head = steps[outputIndex];
  while (head.kind === 'effect') head = steps[head.input];

  const passes = steps.flatMap((step) => (step.kind === 'effect' ? [step.pass] : []));
  return {
    sourceNodeId: head.nodeId,
    plan: { steps, output: outputIndex },
    passes,
    formatter: activeFormatter,
  };
};

/** Whether anything in the chain needs a continuous frame loop. */
export const chainIsAnimated = (chain: ResolvedChain | null): boolean =>
  chain !== null &&
  chain.passes.some(
    (pass) =>
      isAnimated(pass.def, pass.params) ||
      Object.values(pass.modulation).some(signalIsMoving),
  );
