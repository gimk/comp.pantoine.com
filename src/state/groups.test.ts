import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import { MOD_OUTPUT, paramPort, resolveChain, type AppNode } from './graph';
import { drawnEdges, isGroup, paramSpecsOf, planGroup, realWire, type GroupNode } from './groups';
import { deserializeGraph, serializeGraph } from './document';
import { useGraph } from './store';

const image = (id: string, x = 0, y = 0): AppNode => ({
  id,
  type: 'image',
  position: { x, y },
  data: { src: null, name: '', width: 0, height: 0 },
});
const effect = (id: string, effectId: string, x = 0, y = 0): AppNode => ({
  id,
  type: 'effect',
  position: { x, y },
  data: { effectId, params: {} },
});
const lfo = (id: string, x = 0, y = 0): AppNode => ({
  id,
  type: 'modulator',
  position: { x, y },
  data: { modulatorId: 'lfo', params: {} },
});
const viewer = (id: string): AppNode => ({ id, type: 'renderOutput', position: { x: 900, y: 0 }, data: { width: 360 } });
const wire = (id: string, source: string, target: string, sourceHandle: string | null = null, targetHandle: string | null = null): Edge => ({
  id,
  source,
  target,
  sourceHandle,
  targetHandle,
  type: 'link',
});

/* image -> blur -> grain -> viewer, with an LFO on the grain's amount. */
const chain = () => ({
  nodes: [image('img', 0, 0), effect('blur', 'blur', 200, 0), effect('grain', 'grain', 400, 40), lfo('lfo', 200, 200), viewer('out')],
  edges: [
    wire('e1', 'img', 'blur'),
    wire('e2', 'blur', 'grain'),
    wire('e3', 'grain', 'out'),
    wire('e4', 'lfo', 'grain', MOD_OUTPUT, paramPort('amount')),
  ],
});

const planOf = (nodes: AppNode[], edges: Edge[], ids: string[]) => {
  const result = planGroup(nodes, edges, ids);
  if ('reason' in result) throw new Error(result.reason);
  return result.plan;
};

const state = () => useGraph.getState();
const byId = (id: string) => state().nodes.find((node) => node.id === id);
const selectOnly = (ids: string[]) =>
  useGraph.setState({ nodes: state().nodes.map((node) => ({ ...node, selected: ids.includes(node.id) })) });

describe('planning a group', () => {
  it('shows a port for every wire crossing in or out', () => {
    const { nodes, edges } = chain();
    const plan = planOf(nodes, edges, ['blur', 'grain']);
    expect(plan.data.members).toEqual(['blur', 'grain']);
    expect(plan.data.inputs.map((port) => [port.node, port.handle, port.label, port.kind])).toEqual([
      ['blur', null, 'Blur', 'picture'],
      ['grain', 'param:amount', 'Grain · Amount', 'field'],
    ]);
    expect(plan.data.outputs.map((port) => [port.node, port.handle])).toEqual([['grain', null]]);
    expect(plan.position).toEqual({ x: 200, y: 0 });
  });

  it('shows where an unwired flow begins and ends', () => {
    const nodes = [effect('a', 'blur', 0, 0), effect('b', 'grain', 200, 0)];
    const plan = planOf(nodes, [wire('e', 'a', 'b')], ['a', 'b']);
    expect(plan.data.inputs.map((port) => port.node)).toEqual(['a']);
    expect(plan.data.outputs.map((port) => port.node)).toEqual(['b']);
  });

  it('refuses modules that are not wired together, and fewer than two', () => {
    const { nodes, edges } = chain();
    expect(planGroup(nodes, edges, ['img', 'lfo'])).toHaveProperty('reason');
    expect(planGroup(nodes, edges, ['blur'])).toHaveProperty('reason');
  });

  it('leaves viewers out', () => {
    const { nodes, edges } = chain();
    const plan = planOf(nodes, edges, ['blur', 'grain', 'out']);
    expect(plan.data.members).toEqual(['blur', 'grain']);
  });
});

describe('drawing and making wires through a group', () => {
  const { nodes, edges } = chain();
  const plan = planOf(nodes, edges, ['blur', 'grain']);
  const group: GroupNode = { id: 'g', type: 'moduleGroup', position: plan.position, data: plan.data };
  const all = [...nodes, group];

  it('draws crossing wires to the card, and none inside it', () => {
    const drawn = drawnEdges([group], edges);
    expect(drawn.map((edge) => [edge.id, edge.source, edge.sourceHandle, edge.target, edge.targetHandle])).toEqual([
      ['e1', 'img', null, 'g', 'in-0'],
      ['e3', 'g', 'out-0', 'out', null],
      ['e4', 'lfo', MOD_OUTPUT, 'g', 'in-1'],
    ]);
    expect(drawnEdges([], edges)).toBe(edges);
  });

  it('turns a wire to the card into one to the module inside', () => {
    expect(realWire(all, { source: 'lfo', sourceHandle: MOD_OUTPUT, target: 'g', targetHandle: 'in-1' })).toEqual({
      source: 'lfo',
      sourceHandle: MOD_OUTPUT,
      target: 'grain',
      targetHandle: 'param:amount',
    });
    expect(realWire(all, { source: 'g', sourceHandle: 'out-0', target: 'out', targetHandle: null })).toMatchObject({
      source: 'grain',
      sourceHandle: null,
    });
  });

  it('leaves the picture exactly as it was', () => {
    expect(resolveChain(all, edges, 'out')).toEqual(resolveChain(nodes, edges, 'out'));
  });
});

describe('grouping in the store', () => {
  it('hides the members behind a card, and ungroups back where the card is', () => {
    const { nodes, edges } = chain();
    useGraph.setState({ nodes, edges });
    selectOnly(['blur', 'grain']);
    expect(state().groupSelection()).toBeNull();

    const group = state().nodes.find(isGroup)!;
    expect(group.selected).toBe(true);
    expect(byId('blur')?.hidden).toBe(true);
    expect(byId('grain')?.hidden).toBe(true);
    expect(state().edges).toBe(edges);

    useGraph.setState({ nodes: state().nodes.map((node) => (node.id === group.id ? { ...node, position: { x: 300, y: 100 } } : node)) });
    state().ungroup(group.id);
    expect(state().nodes.some(isGroup)).toBe(false);
    expect(byId('blur')).toMatchObject({ position: { x: 300, y: 100 }, selected: true });
    expect(byId('blur')?.hidden).toBeUndefined();
    expect(byId('grain')?.position).toEqual({ x: 500, y: 140 });
  });

  it('wires through the card, and deletes its members with it', () => {
    const { nodes, edges } = chain();
    useGraph.setState({ nodes, edges });
    selectOnly(['blur', 'grain']);
    state().groupSelection();
    const group = state().nodes.find(isGroup)!;

    state().onConnect({ source: 'lfo', sourceHandle: MOD_OUTPUT, target: group.id, targetHandle: 'in-1' });
    expect(state().edges.filter((edge) => edge.target === 'grain' && edge.targetHandle === 'param:amount')).toHaveLength(1);

    state().onNodesChange([{ type: 'remove', id: group.id }]);
    expect(state().nodes.map((node) => node.id).sort()).toEqual(['img', 'lfo', 'out']);
    expect(state().edges.some((edge) => edge.source === 'blur' || edge.target === 'grain')).toBe(false);
  });

  it('duplicates a group with members of its own', () => {
    const { nodes, edges } = chain();
    useGraph.setState({ nodes, edges });
    selectOnly(['blur', 'grain']);
    state().groupSelection();
    state().duplicateSelection({ x: 32, y: 32 });

    const groups = state().nodes.filter(isGroup);
    expect(groups).toHaveLength(2);
    const [original, copy] = groups;
    expect(copy.data.members).toHaveLength(2);
    expect(copy.data.members.some((id) => original.data.members.includes(id))).toBe(false);
    expect(copy.data.inputs.every((port) => copy.data.members.includes(port.node))).toBe(true);
    for (const id of copy.data.members) expect(byId(id)).toMatchObject({ hidden: true, selected: false });
  });

  it('cannot select a hidden member', () => {
    const { nodes, edges } = chain();
    useGraph.setState({ nodes, edges });
    selectOnly(['blur', 'grain']);
    state().groupSelection();
    state().setAllSelected(true);
    expect(byId('blur')?.selected).toBe(false);
    state().onNodesChange([{ type: 'select', id: 'grain', selected: true }]);
    expect(byId('grain')?.selected).toBe(false);
  });
});

describe('saving a group', () => {
  it('round-trips, with members hidden again on load', () => {
    const { nodes, edges } = chain();
    const plan = planOf(nodes, edges, ['blur', 'grain']);
    const group: AppNode = { id: 'group-9', type: 'moduleGroup', position: plan.position, data: { ...plan.data, name: 'Look' } };
    const loaded = deserializeGraph(JSON.parse(JSON.stringify(serializeGraph([...nodes, group], edges))))!;
    const back = loaded.nodes.find(isGroup)!;
    expect(back.data).toEqual({ ...plan.data, name: 'Look' });
    expect(loaded.nodes.find((node) => node.id === 'blur')?.hidden).toBe(true);
    expect(loaded.nodes.find((node) => node.id === 'img')?.hidden).toBeUndefined();
  });

  it('drops a group whose members are gone', () => {
    const doc = serializeGraph([image('img'), { id: 'g', type: 'moduleGroup', position: { x: 0, y: 0 }, data: { name: 'G', members: ['img', 'gone'], inputs: [], outputs: [] } }], []);
    const loaded = deserializeGraph(doc)!;
    expect(loaded.nodes.map((node) => node.id)).toEqual(['img']);
    expect(loaded.nodes[0].hidden).toBeUndefined();
  });
});

describe('what a module offers to expose', () => {
  it('leaves out params its card edits itself, such as a curve’s points', () => {
    const keys = paramSpecsOf(effect('c', 'curves')).map((spec) => spec.key);
    expect(keys).toEqual(['mix']);
  });
});

describe('dropping a group on a wire', () => {
  /* image -> viewer, with a blur -> grain chain beside it, grouped. */
  const loose = () => {
    useGraph.setState({
      nodes: [image('img', 0, 0), effect('blur', 'blur', 200, 300), effect('grain', 'grain', 400, 300), viewer('out')],
      edges: [wire('pic', 'img', 'out'), wire('inner', 'blur', 'grain')],
    });
    selectOnly(['blur', 'grain']);
    state().groupSelection();
    return state().nodes.find(isGroup)!;
  };

  it('splices the chain it holds into the wire', () => {
    const group = loose();
    state().insertNodeOnEdge(group.id, 'pic');
    const edges = state().edges;
    expect(edges.find((edge) => edge.id === 'pic')).toBeUndefined();
    expect(edges.some((edge) => edge.source === 'img' && edge.target === 'blur' && !edge.targetHandle)).toBe(true);
    expect(edges.some((edge) => edge.source === 'grain' && edge.target === 'out')).toBe(true);
    expect(edges.some((edge) => edge.id === 'inner')).toBe(true);
  });

  it('refuses a group that makes its own picture', () => {
    useGraph.setState({
      nodes: [image('src', 0, 0), effect('blur', 'blur', 200, 0), image('img', 0, 300), viewer('out')],
      edges: [wire('feed', 'src', 'blur'), wire('pic', 'img', 'out')],
    });
    selectOnly(['src', 'blur']);
    state().groupSelection();
    const group = state().nodes.find(isGroup)!;
    const before = state().edges;
    state().insertNodeOnEdge(group.id, 'pic');
    expect(state().edges).toBe(before);
  });
});
