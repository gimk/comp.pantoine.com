/**
 * Groups: several modules shown as one opaque card.
 *
 * A group is display only. Its members stay in the graph as ordinary nodes,
 * hidden, and keep every wire they had -- so the renderer, the document's
 * wiring and every rule about what may connect to what carry on unchanged.
 * What the group adds is a card with a port for each member port the outside
 * world reaches, and a translation between the two: a wire into a member is
 * drawn into the group's port, and a wire dropped on the group's port is
 * made into the member's.
 *
 * The pure part lives here, so the store, the canvas and the loader agree.
 */
import type { Edge, XYPosition } from '@xyflow/react';
import { getEffect } from '../engine/registry';
import { getGenerator } from '../engine/generators';
import { inputsOf, paramsOf, type ParamSpec } from '../engine/effects';
import { getModulator, modulatorParamsOf } from '../engine/modulators';
import {
  MOD_OUTPUT,
  hasTargetPort,
  isParamPort,
  paramPort,
  portTakesField,
  samePort,
  type AppNode,
  type ExposedParam,
  type GroupNodeData,
  type GroupPort,
} from './graph';

export type GroupNode = Extract<AppNode, { type: 'moduleGroup' }>;

export const isGroup = (node: AppNode | undefined): node is GroupNode => node?.type === 'moduleGroup';

/*
 * The modules a group can hold: the ones that make or change a picture or a
 * signal. Viewers, Renders, Exports and the Background are where a flow ends
 * and are worked with directly -- a preview or a Render button hidden inside
 * a closed box would be no use to anyone.
 */
const GROUPABLE = new Set<AppNode['type']>(['image', 'video', 'generator', 'effect', 'modulator']);

export const canJoinGroup = (node: AppNode): boolean => GROUPABLE.has(node.type) && !node.hidden;

/** The handle a group's card gives its nth input or output. */
export const groupHandle = (side: 'in' | 'out', index: number): string => `${side}-${index}`;

const HANDLE_PATTERN = /^(in|out)-(\d+)$/;

/** The member port behind one of a group's handles, if the handle is one. */
export const memberPort = (group: GroupNode, handle: string | null | undefined): GroupPort | undefined => {
  const match = handle ? HANDLE_PATTERN.exec(handle) : null;
  if (!match) return undefined;
  const ports = match[1] === 'in' ? group.data.inputs : group.data.outputs;
  return ports[Number(match[2])];
};

/** Either end of a wire, as the canvas hands it over. */
type Wire = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

/**
 * A wire drawn to or from a group's card, as the wire between members it
 * really is. Anything not touching a group comes back as it was.
 */
export const realWire = <W extends Wire>(nodes: AppNode[], wire: W): W => {
  const source = nodes.find((node) => node.id === wire.source);
  const target = nodes.find((node) => node.id === wire.target);
  const from = isGroup(source) ? memberPort(source, wire.sourceHandle) : undefined;
  const into = isGroup(target) ? memberPort(target, wire.targetHandle) : undefined;
  if (!from && !into) return wire;
  return {
    ...wire,
    ...(from ? { source: from.node, sourceHandle: from.handle } : {}),
    ...(into ? { target: into.node, targetHandle: into.handle } : {}),
  };
};

const defOf = (node: AppNode) => {
  if (node.type === 'effect') return getEffect(node.data.effectId);
  if (node.type === 'generator') return getGenerator(node.data.generatorId) ?? getEffect(node.data.generatorId);
  return undefined;
};

/** What a module is called on its own card. */
export const moduleLabel = (node: AppNode): string => {
  if (node.type === 'modulator') return getModulator(node.data.modulatorId)?.label ?? 'Modulator';
  if (node.type === 'image') return node.data.name || 'Image';
  if (node.type === 'video') return node.data.name || 'Video';
  if (node.type === 'effect' || node.type === 'generator') return defOf(node)?.label ?? 'Unknown';
  return node.type;
};

/** The params a module has, as its card shows them; none for a picture. */
export const paramSpecsOf = (node: AppNode): ParamSpec[] => {
  if (node.type === 'modulator') {
    const def = getModulator(node.data.modulatorId);
    return def ? modulatorParamsOf(def) : [];
  }
  const def = defOf(node);
  return def ? paramsOf(def).filter((spec) => !spec.hidden) : [];
};

/**
 * A module's named picture inputs -- a Blend's Layer, a mask -- beyond the
 * main one, which is where a flow begins and always has a port.
 */
export const pictureInputsOf = (node: AppNode): { key: string; label: string }[] => {
  const def = defOf(node);
  return def ? inputsOf(def).map((input) => ({ key: input.key, label: input.label })) : [];
};

/** The member handle an exposed param or input is reached through. */
export const exposedHandle = (param: ExposedParam): string => (param.input ? param.key : paramPort(param.key));

/** Whether a module still has what an exposed entry names. */
export const canExpose = (node: AppNode, param: ExposedParam): boolean =>
  param.input
    ? pictureInputsOf(node).some((input) => input.key === param.key)
    : paramSpecsOf(node).some((spec) => spec.key === param.key);

/**
 * A member port as the group's card shows it: the module's name, and the
 * port's after it unless it is the main picture -- "Blur", "Blur · Radius".
 */
const describeInput = (node: AppNode, handle: string | null): GroupPort => {
  const name = moduleLabel(node);
  if (isParamPort(handle)) {
    const key = handle.slice('param:'.length);
    const spec = paramSpecsOf(node).find((candidate) => candidate.key === key);
    return {
      node: node.id,
      handle,
      // A video's speed is its one port and has no spec to name it.
      label: `${name} · ${spec?.label ?? key.charAt(0).toUpperCase() + key.slice(1)}`,
      kind: portTakesField(node, handle) ? 'field' : 'param',
    };
  }
  if (handle) {
    const def = defOf(node);
    const input = def && inputsOf(def).find((candidate) => candidate.key === handle);
    return { node: node.id, handle, label: `${name} · ${input?.label ?? handle}`, kind: 'picture' };
  }
  return { node: node.id, handle: null, label: name, kind: 'picture' };
};

const describeOutput = (node: AppNode, handle: string | null): GroupPort => ({
  node: node.id,
  handle,
  label: moduleLabel(node),
  kind: handle === MOD_OUTPUT ? 'mod' : 'picture',
});

/** The port a module puts its result out on. */
const mainOutput = (node: AppNode): string | null => (node.type === 'modulator' ? MOD_OUTPUT : null);

/** Whether a set of modules hangs together through wires among themselves. */
const isConnected = (ids: Set<string>, edges: Edge[]): boolean => {
  const neighbours = new Map<string, string[]>();
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    neighbours.set(edge.source, [...(neighbours.get(edge.source) ?? []), edge.target]);
    neighbours.set(edge.target, [...(neighbours.get(edge.target) ?? []), edge.source]);
  }
  const [first] = ids;
  const seen = new Set([first]);
  const pending = [first];
  while (pending.length > 0) {
    for (const next of neighbours.get(pending.pop()!) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      pending.push(next);
    }
  }
  return seen.size === ids.size;
};

/** Why a selection cannot be grouped. */
export const TOO_FEW = 'Select at least two modules to group';
export const NOT_ONE_FLOW = 'Only modules wired together in one flow can be grouped';

export type GroupPlan = {
  /** Where the card goes: where the members' top-left corner was. */
  position: XYPosition;
  data: GroupNodeData;
};

/**
 * What grouping these modules would make, or why it cannot.
 *
 * A group already in the selection is opened and its members taken in, so
 * groups never nest. Viewers and the other ends of a flow are left out (see
 * GROUPABLE). What remains has to be at least two modules, joined by wires
 * among themselves -- one flow, as the user picked it.
 *
 * The card's inputs are every member port a wire reaches from outside, and
 * the main input of any member with nothing on it -- where the flow begins.
 * Its outputs are every member port a wire leaves by, and the result of any
 * member that feeds nothing -- where the flow ends. Each port appears once
 * however many wires use it, ordered top to bottom as the members were.
 */
export const planGroup = (
  nodes: AppNode[],
  edges: Edge[],
  ids: string[],
): { plan: GroupPlan } | { reason: string } => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const picked = new Set<string>();
  for (const id of ids) {
    const node = byId.get(id);
    if (isGroup(node)) node.data.members.forEach((member) => picked.add(member));
    else if (node && canJoinGroup(node)) picked.add(id);
  }
  const members = nodes.filter((node) => picked.has(node.id) && GROUPABLE.has(node.type));
  if (members.length < 2) return { reason: TOO_FEW };
  const memberIds = new Set(members.map((node) => node.id));
  if (!isConnected(memberIds, edges)) return { reason: NOT_ONE_FLOW };

  // Top to bottom, then left to right: the order a reader meets them in.
  const order = [...members].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const rank = new Map(order.map((node, index) => [node.id, index]));

  const inputs: GroupPort[] = [];
  const outputs: GroupPort[] = [];
  const add = (ports: GroupPort[], port: GroupPort) => {
    if (!ports.some((other) => other.node === port.node && samePort(other.handle, port.handle))) ports.push(port);
  };

  for (const node of order) {
    for (const edge of edges) {
      if (edge.target === node.id && !memberIds.has(edge.source)) add(inputs, describeInput(node, edge.targetHandle ?? null));
    }
    if (hasTargetPort(node, null) && !edges.some((edge) => edge.target === node.id && samePort(edge.targetHandle, null))) {
      add(inputs, describeInput(node, null));
    }
    for (const edge of edges) {
      if (edge.source === node.id && !memberIds.has(edge.target)) add(outputs, describeOutput(node, edge.sourceHandle ?? null));
    }
    if (!edges.some((edge) => edge.source === node.id)) add(outputs, describeOutput(node, mainOutput(node)));
  }
  // Main pictures first on each side, then the rest, each in member order.
  const byKind = (a: GroupPort, b: GroupPort) =>
    Number(a.handle !== null && a.handle !== MOD_OUTPUT) - Number(b.handle !== null && b.handle !== MOD_OUTPUT) ||
    rank.get(a.node)! - rank.get(b.node)!;
  inputs.sort(byKind);
  outputs.sort(byKind);

  return {
    plan: {
      position: {
        x: Math.min(...members.map((node) => node.position.x)),
        y: Math.min(...members.map((node) => node.position.y)),
      },
      data: { name: 'Group', members: order.map((node) => node.id), inputs, outputs },
    },
  };
};

/**
 * A group's inputs once `exposed` is what its card shows.
 *
 * An exposed param or input takes a wire on the card, as it does on its
 * module, so it needs an input port -- unless a wire from inside the group
 * already drives it, which leaves nothing to plug in. A port no longer
 * exposed goes again, unless a wire from outside still uses it; a main
 * picture input always stays.
 */
export const exposePorts = (group: GroupNode, nodes: AppNode[], edges: Edge[], exposed: ExposedParam[]): GroupPort[] => {
  const members = new Set(group.data.members);
  const wiredFrom = (port: { node: string; handle: string | null }) =>
    edges.filter((edge) => edge.target === port.node && samePort(edge.targetHandle, port.handle));
  const entryFor = (port: { node: string; handle: string | null }) =>
    exposed.find((param) => param.node === port.node && port.handle === exposedHandle(param));
  const isExposed = (port: GroupPort) => entryFor(port) !== undefined;
  const labelOf = (port: { node: string; handle: string | null }) => entryFor(port)?.label?.trim() || undefined;

  // A main input is where the flow begins and always keeps its port.
  const inputs = group.data.inputs
    .filter(
      (port) =>
        port.handle === null ||
        isExposed(port) ||
        wiredFrom(port).some((edge) => !members.has(edge.source)),
    )
    // Each port named afresh: by the name the user gave it, or else the
    // module's own, so a name given and then cleared goes back.
    .map((port) => {
      const node = nodes.find((candidate) => candidate.id === port.node);
      return node ? { ...port, label: labelOf(port) ?? describeInput(node, port.handle).label } : port;
    });
  for (const param of exposed) {
    const node = nodes.find((candidate) => candidate.id === param.node);
    const handle = exposedHandle(param);
    if (!node || !members.has(node.id) || !hasTargetPort(node, handle)) continue;
    if (inputs.some((port) => port.node === node.id && port.handle === handle)) continue;
    if (wiredFrom({ node: node.id, handle }).some((edge) => members.has(edge.source))) continue;
    const port = describeInput(node, handle);
    inputs.push({ ...port, label: labelOf(port) ?? port.label });
  }
  return inputs;
};

/** The real wire behind a drawn one, carried on the drawn one for its colour. */
export type DrawnEdgeData = { real: Wire };

/**
 * The wires as the canvas draws them: a wire between two members of one
 * group is not drawn at all, and one crossing a group's edge is drawn to the
 * card's port instead of the hidden member's. Ids are kept, so selecting or
 * removing a drawn wire acts on the real one. Wires that touch no group come
 * back as the same objects, so nothing redraws that did not change.
 */
export const drawnEdges = (groups: GroupNode[], edges: Edge[]): Edge[] => {
  if (groups.length === 0) return edges;
  const groupOf = new Map<string, GroupNode>();
  for (const group of groups) for (const member of group.data.members) groupOf.set(member, group);

  const drawn: Edge[] = [];
  for (const edge of edges) {
    const from = groupOf.get(edge.source);
    const into = groupOf.get(edge.target);
    if (!from && !into) {
      drawn.push(edge);
      continue;
    }
    if (from && from === into) continue;
    const out = from?.data.outputs.findIndex(
      (port) => port.node === edge.source && samePort(port.handle, edge.sourceHandle),
    );
    const inn = into?.data.inputs.findIndex(
      (port) => port.node === edge.target && samePort(port.handle, edge.targetHandle),
    );
    // A wire on a member port the card does not show has nowhere to be
    // drawn. The group never makes one; a hand-edited document might.
    if (out === -1 || inn === -1) continue;
    const data: DrawnEdgeData = {
      real: { source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle },
    };
    drawn.push({
      ...edge,
      ...(from ? { source: from.id, sourceHandle: groupHandle('out', out!) } : {}),
      ...(into ? { target: into.id, targetHandle: groupHandle('in', inn!) } : {}),
      data,
    });
  }
  return drawn;
};

/**
 * Where a group's members go when it is opened: laid out as they were, with
 * their top-left corner wherever the card has been moved to.
 */
export const ungroupOffset = (group: GroupNode, members: AppNode[]): XYPosition => {
  if (members.length === 0) return { x: 0, y: 0 };
  return {
    x: group.position.x - Math.min(...members.map((node) => node.position.x)),
    y: group.position.y - Math.min(...members.map((node) => node.position.y)),
  };
};

/**
 * Where a group sits in a chain, if it can sit in one: the member whose
 * main input is the card's first picture input, and the member whose main
 * result is its first picture output. Both have to be effects -- a group
 * that starts at an image or a generator makes its own picture and has
 * nothing to take from a wire.
 */
export const chainEnds = (nodes: AppNode[], group: GroupNode): { entry: string; exit: string } | null => {
  const entry = group.data.inputs.find((port) => port.kind === 'picture' && port.handle === null);
  const exit = group.data.outputs.find((port) => port.kind === 'picture' && port.handle === null);
  if (!entry || !exit) return null;
  const isEffect = (id: string) => nodes.some((node) => node.id === id && node.type === 'effect');
  return isEffect(entry.node) && isEffect(exit.node) ? { entry: entry.node, exit: exit.node } : null;
};

/** A set of node ids with every selected group's members added. */
export const withMembers = (nodes: AppNode[], ids: Iterable<string>): Set<string> => {
  const all = new Set(ids);
  for (const node of nodes) if (isGroup(node) && all.has(node.id)) node.data.members.forEach((member) => all.add(member));
  return all;
};
