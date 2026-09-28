import type { Edge, Node } from '@xyflow/react';
import { getEffect } from '../engine/registry';
import { getGenerator } from '../engine/generators';
import { acceptsField, inputsOf, isAnimated, paramsOf, type EffectDef, type ParamValue } from '../engine/effects';
import {
  getModulator,
  modulatorPortsOf,
  modulatedValue,
  signalBounds,
  signalIsMoving,
  type Interval,
  type Signal,
} from '../engine/modulators';
import { getImage } from '../engine/imageStore';
import { getVideo } from '../engine/videoStore';
import type { FieldBinding, FieldPort, Pass, RenderPlan, Step } from '../engine/pipeline';

export type ImageNodeData = {
  /** Object URL for the thumbnail, or null while the node is still empty. */
  src: string | null;
  name: string;
  width: number;
  height: number;
  /** Error message if decoding or loading failed. */
  error?: string | null;
};

export type VideoNodeData = {
  /** Object URL for the video source, or null while empty. */
  src: string | null;
  name: string;
  width: number;
  height: number;
  duration: number;
  speed?: number;
  loop?: boolean;
  muted?: boolean;
  playbackRate?: number;
  /** Error message if decoding or loading failed. */
  error?: string | null;
};

export type GeneratorNodeData = {
  generatorId: string;
  width: number;
  height: number;
  params: Record<string, ParamValue>;
};

export type EffectNodeData = {
  effectId: string;
  params: Record<string, ParamValue>;
};

export type ModulatorNodeData = {
  modulatorId: string;
  params: Record<string, ParamValue>;
  /**
   * Set on the Math node a video brings with it to drive its speed, naming
   * that video. Only a mark: the helper is removed with the video when it is
   * still wired to nothing else, and is an ordinary modulator otherwise.
   */
  helperFor?: string;
};

export type OutputNodeData = {
  /**
   * Preview width in graph units. The height is not stored: it follows the
   * image's own ratio, so there is only ever one number to keep.
   */
  width: number;
};

export type ExportFormat = 'png' | 'jpg' | 'gif' | 'mp4' | 'webm';

/**
 * A Render node's recipe -- and only the recipe. What it has baked, and how
 * far along a bake is, lives in `renderJobs`: it is session state, and here
 * it would be saved, snapshotted by undo and copied with a duplicate.
 */
export type RenderNodeData = {
  format: ExportFormat;
  quality: number;
  scale: number;
  time: number;
  duration: number;
  fps: number;
  loopPreview?: boolean;
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

/*
 * What a render can sensibly be asked for. GIF stores frame delays in
 * hundredths of a second and holds every frame in memory until it encodes,
 * so it gets a lower frame rate and a shorter clip than the video
 * containers (15-30 fps is the usual range). A still ignores frame rate and
 * duration, so beyond the general sanity caps they are left alone, ready for
 * when the format is switched back.
 */
export const RENDER_LIMITS = {
  scale: { min: 0.05, max: 4 },
  quality: { min: 0.01, max: 1 },
  fps: { min: 1, max: 60 },
  duration: { min: 0.1, max: 600 },
  gif: { maxFps: 30, maxDuration: 30 },
} as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const isStillFormat = (format: ExportFormat): boolean => format === 'png' || format === 'jpg';

/**
 * Render settings brought within what their format can do. Returns `data`
 * itself when nothing needed changing, so a no-op edit is not a new object.
 */
export const clampRenderData = (data: RenderNodeData): RenderNodeData => {
  const gif = data.format === 'gif';
  const still = isStillFormat(data.format);
  const fpsMax = gif ? RENDER_LIMITS.gif.maxFps : RENDER_LIMITS.fps.max;
  const durationMax = gif ? RENDER_LIMITS.gif.maxDuration : RENDER_LIMITS.duration.max;
  const fixed: RenderNodeData = {
    format: data.format,
    quality: clamp(data.quality, RENDER_LIMITS.quality.min, RENDER_LIMITS.quality.max),
    scale: clamp(data.scale, RENDER_LIMITS.scale.min, RENDER_LIMITS.scale.max),
    time: Math.max(0, data.time),
    duration: still
      ? clamp(data.duration, RENDER_LIMITS.duration.min, RENDER_LIMITS.duration.max)
      : clamp(data.duration, RENDER_LIMITS.duration.min, durationMax),
    fps: Math.round(
      still ? clamp(data.fps, RENDER_LIMITS.fps.min, RENDER_LIMITS.fps.max) : clamp(data.fps, RENDER_LIMITS.fps.min, fpsMax),
    ),
  };
  if (data.loopPreview !== undefined) fixed.loopPreview = data.loopPreview;
  const same = (Object.keys(fixed) as (keyof RenderNodeData)[]).every((key) => fixed[key] === data[key]);
  return same && Object.keys(data).length === Object.keys(fixed).length ? data : fixed;
};

export type ExportNodeData = {
  filenamePrefix: string;
};

export const DEFAULT_EXPORT_DATA: ExportNodeData = {
  filenamePrefix: '',
};

export type BackgroundNodeData = {
  enabled: boolean;
  fit: 'fill' | 'fit' | 'cover' | 'contain';
  opacity: number;
};

export const DEFAULT_BACKGROUND_DATA: BackgroundNodeData = {
  enabled: true,
  fit: 'fill',
  opacity: 1,
};

export type AppNode =
  | Node<ImageNodeData, 'image'>
  | Node<VideoNodeData, 'video'>
  | Node<GeneratorNodeData, 'generator'>
  | Node<EffectNodeData, 'effect'>
  | Node<ModulatorNodeData, 'modulator'>
  | Node<OutputNodeData, 'renderOutput'>
  | Node<BackgroundNodeData, 'backgroundOutput'>
  | Node<RenderNodeData, 'render'>
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

const isPassThrough = (node: AppNode | undefined): boolean =>
  node?.type === 'renderOutput' || node?.type === 'backgroundOutput';

/**
 * Walk backwards along purple edges through any intermediate pass-through viewers
 * to locate the upstream Render node producing the asset.
 *
 * One visited set for the whole walk, and no recursion: two viewers wired
 * into each other are a loop a user can make (or an old save can hold), and
 * the walk has to come back with an answer rather than blow the stack.
 */
export const findUpstreamRenderNode = (
  nodes: AppNode[],
  edges: Edge[],
  startNodeId: string,
): Node<RenderNodeData, 'render'> | null => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const pending = [startNodeId];

  while (pending.length > 0) {
    const currentId = pending.pop()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const through: string[] = [];
    for (const edge of edges) {
      if (edge.target !== currentId) continue;
      const source = byId.get(edge.source);
      if (source?.type === 'render') return source;
      if (isPassThrough(source)) through.push(source!.id);
    }
    // Reversed so the first wire is the first one followed.
    for (let i = through.length - 1; i >= 0; i -= 1) pending.push(through[i]);
  }
  return null;
};

/**
 * Whether what comes out of a node is a baked file rather than a live
 * picture: a Render node, or a viewer or background showing one. It decides
 * a wire's colour and which ports it may go into.
 */
export const carriesRenderAsset = (nodes: AppNode[], edges: Edge[], nodeId: string): boolean => {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (node?.type === 'render') return true;
  return isPassThrough(node) && findUpstreamRenderNode(nodes, edges, nodeId) !== null;
};

/** The frame a fill sets when nothing else in the chain does: a fresh generator's. */
export const FILL_SIZE = { width: 1280, height: 720 } as const;

const effectDefOf = (node: AppNode): EffectDef | undefined =>
  node.type === 'effect'
    ? getEffect(node.data.effectId)
    : node.type === 'generator'
      ? getGenerator(node.data.generatorId) ?? getEffect(node.data.generatorId)
      : undefined;

/**
 * Whether this port takes a picture as a field -- a diamond socket, in
 * Blender's terms. A module's params mostly do (see `acceptsField`); so do
 * the ports of a Math or Map Range, which then work per pixel. A source
 * modulator's ports and a video's speed are round: they need one number.
 */
export const portTakesField = (node: AppNode | undefined, handle: string | null | undefined): boolean => {
  if (!node || !isParamPort(handle)) return false;
  const key = handle.slice(PARAM_PORT_PREFIX.length);
  if (node.type === 'modulator') {
    const def = getModulator(node.data.modulatorId);
    return !!def?.field && modulatorPortsOf(def).includes(key);
  }
  const def = effectDefOf(node);
  const spec = def && paramsOf(def).find((candidate) => candidate.key === key);
  return !!def && !!spec && acceptsField(def, spec);
};

/**
 * Whether what comes out of a node is a field: a picture, or a Math or Map
 * Range that a picture reaches through one of its ports -- so its output
 * is a value per pixel. This is how a Blender socket turns into a diamond:
 * decided by what is wired upstream, not by the node.
 */
const isFieldSource = (
  byId: Map<string, AppNode>,
  sourceOf: PortIndex,
  nodeId: string | undefined,
  seen: Set<string> = new Set(),
): boolean => {
  if (nodeId === undefined || seen.has(nodeId)) return false;
  const node = byId.get(nodeId);
  if (!node || node.type === 'export') return false;
  if (node.type !== 'modulator') return true;
  const def = getModulator(node.data.modulatorId);
  if (!def?.field) return false;
  seen.add(nodeId);
  const field = modulatorPortsOf(def).some((key) => isFieldSource(byId, sourceOf, sourceOf(nodeId, paramPort(key)), seen));
  seen.delete(nodeId);
  return field;
};

/** Whether a modulator node's output is currently a field rather than a single number. */
export const outputIsField = (nodes: AppNode[], edges: Edge[], nodeId: string): boolean => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return byId.get(nodeId)?.type === 'modulator' && isFieldSource(byId, indexPorts(edges), nodeId);
};

/**
 * What a wire carries, for its colour: a picture, a single number, a
 * field (a picture going into a param, or out of a per-pixel Math), a
 * baked file -- or nothing usable, when a field reaches a port that needs
 * one number. Blender draws that last one red and leaves it in place, so
 * the wiring survives while it is fixed; so does this.
 */
export type WireKind = 'picture' | 'signal' | 'field' | 'render' | 'invalid';

export const wireKind = (
  nodes: AppNode[],
  edges: Edge[],
  edge: Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>,
): WireKind => {
  if (isRenderPort(edge.targetHandle) || isRenderPort(edge.sourceHandle)) return 'render';
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const source = byId.get(edge.source);
  const field = isFieldSource(byId, indexPorts(edges), edge.source);
  if (isParamPort(edge.targetHandle)) {
    if (!field) return 'signal';
    return portTakesField(byId.get(edge.target), edge.targetHandle) ? 'field' : 'invalid';
  }
  if (source?.type === 'modulator') return field ? 'field' : 'signal';
  return carriesRenderAsset(nodes, edges, edge.source) ? 'render' : 'picture';
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
  if (node.type === 'renderOutput' || node.type === 'backgroundOutput') {
    return !handle || isRenderPort(handle);
  }
  if (node.type === 'export') {
    return isRenderPort(handle);
  }
  if (node.type === 'render') {
    return !handle;
  }
  if (node.type === 'modulator') {
    const def = getModulator(node.data.modulatorId);
    if (!def) return false;
    if (!handle) return !!def.picture;
    return isParamPort(handle) && modulatorPortsOf(def).includes(handle.slice(PARAM_PORT_PREFIX.length));
  }
  if (node.type === 'video') {
    if (isParamPort(handle)) {
      const key = handle.slice(PARAM_PORT_PREFIX.length);
      return key === 'speed';
    }
    return false;
  }
  if (node.type === 'generator') {
    const def = getGenerator(node.data.generatorId) ?? getEffect(node.data.generatorId);
    if (!def) return false;
    if (isParamPort(handle)) {
      const key = handle.slice(PARAM_PORT_PREFIX.length);
      return paramsOf(def).some((spec) => spec.key === key);
    }
    return false;
  }
  if (node.type !== 'effect') return false;
  if (!handle) return true;
  const def = getEffect(node.data.effectId);
  if (!def) return false;
  if (isParamPort(handle)) {
    const key = handle.slice(PARAM_PORT_PREFIX.length);
    return paramsOf(def).some((spec) => spec.key === key);
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
 *
 * A field on a port -- a picture, or a Math a picture reaches -- is not a
 * number, so it counts as unwired here; the wire shows red. `onStatistic`
 * is told about every Image Statistic the signal reads, so the renderer
 * can measure its picture before the signal is needed.
 */
const signalFrom = (
  byId: Map<string, AppNode>,
  sourceOf: PortIndex,
  nodeId: string | undefined,
  visiting: Set<string>,
  onStatistic?: (nodeId: string) => void,
): Signal | null => {
  if (nodeId === undefined || visiting.has(nodeId)) return null;
  const node = byId.get(nodeId);
  if (!node || node.type !== 'modulator') return null;
  const def = getModulator(node.data.modulatorId);
  if (!def) return null;

  visiting.add(nodeId);
  const inputs: Record<string, Signal> = {};
  for (const key of modulatorPortsOf(def)) {
    const source = sourceOf(nodeId, paramPort(key));
    if (isFieldSource(byId, sourceOf, source)) continue;
    const input = signalFrom(byId, sourceOf, source, visiting, onStatistic);
    if (input) inputs[key] = input;
  }
  visiting.delete(nodeId);

  const identity = identityOf(node.id);
  if (def.picture) onStatistic?.(nodeId);
  return { def, params: node.data.params, seed: seedFor(identity), inputs, ...(def.picture ? { nodeId: identity } : {}) };
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
  /** Modulation applied to video nodes in the graph (nodeId -> { speed?: Signal, time?: Signal }) */
  videoModulation?: Map<string, Record<string, Signal>>;
  /** The recipe from the nearest Render node on the main path, if any. */
  formatter?: RenderNodeData;
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
      output.type !== 'backgroundOutput' &&
      output.type !== 'export' &&
      output.type !== 'render')
  ) {
    return null;
  }

  // The recipe comes from the main path only -- the output itself, or the
  // first Render met walking back along main inputs. A Render feeding an
  // effect's extra input is a side branch, and its format and timing say
  // nothing about what this output is showing.
  let activeFormatter: RenderNodeData | undefined;
  {
    const seen = new Set<string>();
    let current: AppNode | undefined = output;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.type === 'render') {
        activeFormatter = current.data;
        break;
      }
      if (current.type !== 'effect' && !isPassThrough(current) && current.type !== 'export') break;
      const upstream = sourceOf(current.id, null);
      current = upstream === undefined ? undefined : byId.get(upstream);
    }
  }

  const steps: Step[] = [];
  const done = new Map<string, number | null>();
  const visiting = new Set<string>();
  const videoModulation = new Map<string, Record<string, Signal>>();

  /*
   * Image Statistic nodes read by any signal in this chain. Each is
   * measured once, as a step placed before whatever reads it -- the signal
   * is resolved while its reader is being visited, before the reader's own
   * step is pushed -- so a knob follows its picture on the same frame.
   */
  const measured = new Set<string>();
  const measure = (statId: string): void => {
    if (measured.has(statId)) return;
    measured.add(statId);
    const input = visit(sourceOf(statId, null));
    steps.push({ kind: 'statistic', nodeId: identityOf(statId), input });
  };
  const signalAt = (nodeId: string | undefined): Signal | null =>
    signalFrom(byId, sourceOf, nodeId, new Set(), measure);
  const isField = (nodeId: string | undefined): boolean => isFieldSource(byId, sourceOf, nodeId);

  /**
   * What is wired into a module's params: signals by key, and the pictures
   * of any fields. A field into a param that cannot take one is left out
   * -- the param keeps its value, and the wire shows red.
   */
  const wiringFor = (
    nodeId: string,
    def: EffectDef,
  ): { modulation: Record<string, Signal>; fields: FieldBinding[] } => {
    const modulation: Record<string, Signal> = {};
    const fields: FieldBinding[] = [];
    for (const spec of paramsOf(def)) {
      const source = sourceOf(nodeId, paramPort(spec.key));
      if (source === undefined) continue;
      if (isField(source)) {
        if (!acceptsField(def, spec)) continue;
        const step = visit(source);
        if (step !== null) fields.push({ key: spec.key, step });
        continue;
      }
      const signal = signalAt(source);
      if (signal) modulation[spec.key] = signal;
    }
    return { modulation, fields };
  };

  /**
   * The range a field can take, for Map Range's Auto range: 0..1 for a
   * picture, and through a per-pixel Math, what the Math makes of its
   * inputs' ranges. The same interval arithmetic as for a signal.
   */
  const fieldBounds = (nodeId: string, seen: Set<string> = new Set()): Interval | null => {
    const node = byId.get(nodeId);
    if (node?.type !== 'modulator') return [0, 1];
    const def = getModulator(node.data.modulatorId);
    if (!def || seen.has(nodeId)) return null;
    seen.add(nodeId);
    const { params, ranges } = fieldOpInputs(nodeId, def, seen);
    return def.bounds(ranges, params);
  };

  /** A field operator's params with derived ones worked out, and each port's range. */
  const fieldOpInputs = (nodeId: string, def: NonNullable<ReturnType<typeof getModulator>>, seen?: Set<string>) => {
    const node = byId.get(nodeId) as Node<ModulatorNodeData, 'modulator'>;
    const inputRanges: Record<string, Interval | null> = {};
    for (const key of modulatorPortsOf(def)) {
      const source = sourceOf(nodeId, paramPort(key));
      if (source === undefined) continue;
      if (isField(source)) inputRanges[key] = fieldBounds(source, seen ?? new Set([nodeId]));
      else {
        const signal = signalFrom(byId, sourceOf, source, new Set());
        if (signal) inputRanges[key] = signalBounds(signal);
      }
    }
    const derived = def.derive ? def.derive(node.data.params, inputRanges) : {};
    for (const key of Object.keys(derived)) if (sourceOf(nodeId, paramPort(key)) !== undefined) delete derived[key];
    const params: Record<string, ParamValue> = { ...node.data.params, ...derived };
    const ranges: Record<string, Interval | null> = {};
    for (const spec of def.params) {
      if (!modulatorPortsOf(def).includes(spec.key)) continue;
      if (spec.key in inputRanges) ranges[spec.key] = inputRanges[spec.key];
      else {
        const v = typeof params[spec.key] === 'number' ? (params[spec.key] as number) : 0;
        ranges[spec.key] = [v, v];
      }
    }
    return { params, ranges };
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
    } else if (node?.type === 'video') {
      if (getVideo(node.id)) {
        index = steps.push({ kind: 'video', nodeId: node.id }) - 1;
        const vMod: Record<string, Signal> = {};
        const speedSignal = signalAt(sourceOf(node.id, paramPort('speed')));
        if (speedSignal) vMod.speed = speedSignal;
        if (Object.keys(vMod).length > 0) {
          videoModulation.set(node.id, vMod);
        }
      }
    } else if (node?.type === 'generator') {
      const def = getGenerator(node.data.generatorId) ?? getEffect(node.data.generatorId);
      if (def) {
        const identity = identityOf(node.id);
        const { modulation, fields } = wiringFor(node.id, def);
        const pass: Pass = {
          nodeId: identity,
          seed: seedFor(identity),
          def,
          params: node.data.params,
          modulation,
        };
        index =
          steps.push({
            kind: 'generator',
            nodeId: node.id,
            pass,
            width: node.data.width || FILL_SIZE.width,
            height: node.data.height || FILL_SIZE.height,
            fields,
          }) - 1;
      }
    } else if (node?.type === 'modulator') {
      // A modulator wired where a picture goes: a per-pixel Math if a
      // picture reaches it, and otherwise its one number as a flat grey.
      const def = getModulator(node.data.modulatorId);
      if (def?.field && isField(node.id)) {
        const ports: Record<string, FieldPort> = {};
        for (const key of modulatorPortsOf(def)) {
          const source = sourceOf(node.id, paramPort(key));
          if (source === undefined) continue;
          if (isField(source)) {
            const step = visit(source);
            if (step !== null) ports[key] = { step };
          } else {
            const signal = signalAt(source);
            if (signal) ports[key] = { signal };
          }
        }
        const { params } = fieldOpInputs(node.id, def);
        index = steps.push({ kind: 'fieldOp', nodeId: identityOf(node.id), def, params, ports }) - 1;
      } else if (def) {
        const signal = signalAt(node.id);
        if (signal) index = steps.push({ kind: 'fill', nodeId: identityOf(node.id), signal }) - 1;
      }
    } else if (
      node?.type === 'renderOutput' ||
      node?.type === 'backgroundOutput' ||
      node?.type === 'export' ||
      node?.type === 'render'
    ) {
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
        const { modulation, fields } = wiringFor(node.id, def);
        const pass: Pass = {
          nodeId: identity,
          seed: seedFor(identity),
          def,
          params: node.data.params,
          modulation,
        };
        index = steps.push({ kind: 'effect', pass, input, extras, fields }) - 1;
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

  // Follow main inputs back up to the image, video, or generator that sets
  // the frame -- through a per-pixel Math, by the first picture on its ports.
  let head = steps[outputIndex];
  while (head.kind === 'effect' || head.kind === 'fieldOp') {
    if (head.kind === 'effect') head = steps[head.input];
    else {
      const first = Object.values(head.ports).find((port): port is { step: number } => 'step' in port);
      if (!first) break;
      head = steps[first.step];
    }
  }

  const passes = steps.flatMap((step) =>
    step.kind === 'effect' || step.kind === 'generator' ? [step.pass] : [],
  );
  return {
    sourceNodeId: head.nodeId,
    plan: { steps, output: outputIndex },
    passes,
    videoModulation,
    formatter: activeFormatter,
  };
};

/** Collect all generator node dimensions required by the plan. */
export const generatorsForPlan = (plan: RenderPlan): Map<string, { width: number; height: number }> => {
  const generators = new Map<string, { width: number; height: number }>();
  for (const step of plan.steps) {
    if (step.kind === 'generator') {
      generators.set(step.nodeId, { width: step.width, height: step.height });
    } else if (step.kind === 'fill' || step.kind === 'fieldOp') {
      // Only ever asked for when one heads the chain -- a flat value with
      // nothing else to take the frame from.
      generators.set(step.nodeId, { ...FILL_SIZE });
    }
  }
  return generators;
};

/** Every signal a plan's steps read outside its passes' own modulation. */
const stepSignals = (step: Step): Signal[] =>
  step.kind === 'fill'
    ? [step.signal]
    : step.kind === 'fieldOp'
      ? Object.values(step.ports).flatMap((port) => ('signal' in port ? [port.signal] : []))
      : [];

/** Whether anything in the chain needs a continuous frame loop. */
export const chainIsAnimated = (chain: ResolvedChain | null): boolean =>
  chain !== null &&
  (chain.plan.steps.some((step) => step.kind === 'video' || stepSignals(step).some(signalIsMoving)) ||
    chain.passes.some((pass) => {
      const params = { ...pass.params };
      for (const [key, signal] of Object.entries(pass.modulation)) {
        const spec = paramsOf(pass.def).find((p) => p.key === key);
        if (spec) {
          params[key] = modulatedValue(spec, pass.params[key], signal, 0);
        }
      }
      return isAnimated(pass.def, params) || Object.values(pass.modulation).some(signalIsMoving);
    }));
