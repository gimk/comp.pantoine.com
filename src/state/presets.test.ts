import { beforeEach, describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import { MOD_OUTPUT, paramPort, type AppNode } from './graph';
import { isGroup, planGroup, realWire } from './groups';
import { capturePreset, findPreset, presetGraph, usePresets } from './presets';
import { BUILTIN_PRESETS } from './builtinPresets';
import { getEffect } from '../engine/registry';
import { paramsOf } from '../engine/effects';
import { deserializeGraph, serializeGraph } from './document';
import { useGraph } from './store';

const image = (id: string, x = 0, y = 0): AppNode => ({
  id,
  type: 'image',
  position: { x, y },
  data: { src: null, name: 'cat.png', width: 10, height: 10 },
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

const state = () => useGraph.getState();

beforeEach(() => {
  usePresets.setState({ presets: [], draft: null });
});

describe('saving a preset', () => {
  it('keeps the modules and only the wires among them', () => {
    const { nodes, edges } = chain();
    const captured = capturePreset(nodes, edges, ['blur', 'grain', 'lfo', 'out']);
    if ('reason' in captured) throw new Error(captured.reason);
    expect(captured.graph.nodes.map((node) => node.id)).toEqual(['blur', 'grain', 'lfo']);
    expect(captured.graph.edges.map((edge) => edge.id)).toEqual(['e2', 'e4']);
  });

  it('refuses what could not be grouped', () => {
    const { nodes, edges } = chain();
    expect(capturePreset(nodes, edges, ['blur'])).toHaveProperty('reason');
    expect(capturePreset(nodes, edges, ['img', 'lfo'])).toHaveProperty('reason');
  });

  it('saves a group as its members, under its name, with no member left hidden', () => {
    const { nodes, edges } = chain();
    useGraph.setState({ nodes: nodes.map((node) => ({ ...node, selected: node.id === 'blur' || node.id === 'grain' })), edges });
    state().groupSelection();
    const group = state().nodes.find(isGroup)!;
    state().renameGroup(group.id, 'Soft grain');

    const saved = usePresets.getState().save(state().nodes, state().edges, [group.id]);
    if ('reason' in saved) throw new Error(saved.reason);
    const preset = usePresets.getState().presets[0];
    expect(preset.name).toBe('Soft grain');
    const graph = presetGraph(preset)!;
    expect(graph.nodes.map((node) => node.id)).toEqual(['blur', 'grain']);
    expect(graph.nodes.some((node) => node.hidden)).toBe(false);
  });

  it('never gives two presets one name', () => {
    const { nodes, edges } = chain();
    const { save, update } = usePresets.getState();
    save(nodes, edges, ['blur', 'grain']);
    save(nodes, edges, ['blur', 'grain']);
    expect(usePresets.getState().presets.map((preset) => preset.name)).toEqual(['Preset', 'Preset 2']);
    update(usePresets.getState().presets[1].id, { name: 'Preset', exposed: [] });
    expect(usePresets.getState().presets[1].name).toBe('Preset 2');
  });
});

describe('putting a preset on the canvas', () => {
  it('stamps out fresh, grouped copies, wired as they were and to nothing else', () => {
    const { nodes, edges } = chain();
    useGraph.setState({ nodes, edges });
    usePresets.getState().save(nodes, edges, ['img', 'blur', 'grain', 'lfo'], {
      name: 'Look',
      exposed: [{ node: 'blur', key: 'radius' }, { node: 'lfo', key: 'rate' }],
    });

    const preset = usePresets.getState().presets[0];
    state().insertPreset(presetGraph(preset)!, preset, { x: 1000, y: 500 });

    const group = state().nodes.find(isGroup)!;
    expect(group.data.name).toBe('Look');
    expect(group.selected).toBe(true);
    expect(group.position).toEqual({ x: 1000, y: 500 });
    const members = new Set(group.data.members);
    expect(members.size).toBe(4);
    for (const id of members) {
      expect(['img', 'blur', 'grain', 'lfo']).not.toContain(id);
      expect(state().nodes.find((node) => node.id === id)?.hidden).toBe(true);
    }
    // The originals are untouched, and the copies' wires stay among themselves.
    expect(state().nodes.filter((node) => !members.has(node.id) && !isGroup(node))).toHaveLength(5);
    const fresh = state().edges.filter((edge) => members.has(edge.source) || members.has(edge.target));
    expect(fresh).toHaveLength(3);
    expect(fresh.every((edge) => members.has(edge.source) && members.has(edge.target))).toBe(true);
    // The image comes back naming its file, with no picture.
    const img = state().nodes.find((node) => members.has(node.id) && node.type === 'image');
    expect(img?.type === 'image' && img.data.name).toBe('cat.png');
    // The exposed params point at the copies, in the order chosen.
    const exposed = group.data.exposed!.map((param) => [state().nodes.find((node) => node.id === param.node)?.type, param.key]);
    expect(exposed).toEqual([
      ['effect', 'radius'],
      ['modulator', 'rate'],
    ]);
    expect(group.data.exposed!.every((param) => members.has(param.node))).toBe(true);
  });
});

describe('exposed params', () => {
  it('come with a group saved as a preset, and go when the module loses the param', () => {
    const { nodes, edges } = chain();
    useGraph.setState({ nodes: nodes.map((node) => ({ ...node, selected: node.id === 'blur' || node.id === 'grain' })), edges });
    state().groupSelection();
    const group = state().nodes.find(isGroup)!;
    state().setGroupExposed(group.id, [{ node: 'grain', key: 'amount' }]);

    const captured = capturePreset(state().nodes, state().edges, [group.id]);
    if ('reason' in captured) throw new Error(captured.reason);
    expect(captured.exposed).toEqual([{ node: 'grain', key: 'amount' }]);
    expect(captured.groupId).toBe(group.id);

    // Through the document and back, a param the module does not have is dropped.
    const saved = serializeGraph(state().nodes, state().edges);
    const entry = saved.nodes.find((node) => node.id === group.id) as { exposed?: unknown[] };
    entry.exposed = [...(entry.exposed ?? []), { node: 'grain', key: 'nonsense' }, { node: 'grain', key: 'amount' }];
    const loaded = deserializeGraph(saved)!;
    const back = loaded.nodes.find(isGroup)!;
    expect(back.data.exposed).toEqual([{ node: 'grain', key: 'amount' }]);
  });

  it('follow a copied group to its copies', () => {
    const { nodes, edges } = chain();
    useGraph.setState({ nodes: nodes.map((node) => ({ ...node, selected: node.id === 'blur' || node.id === 'grain' })), edges });
    state().groupSelection();
    const group = state().nodes.find(isGroup)!;
    state().setGroupExposed(group.id, [{ node: 'blur', key: 'radius' }]);
    state().duplicateSelection({ x: 32, y: 32 });
    const copy = state().nodes.find((node) => isGroup(node) && node.id !== group.id);
    if (!isGroup(copy)) throw new Error('no copy');
    expect(copy.data.exposed).toHaveLength(1);
    expect(copy.data.exposed![0].node).not.toBe('blur');
    expect(copy.data.members).toContain(copy.data.exposed![0].node);
  });
});

describe('sockets on exposed params', () => {
  const groupOf = (exposed: { node: string; key: string }[]) => {
    const { nodes, edges } = chain();
    useGraph.setState({ nodes: nodes.map((node) => ({ ...node, selected: node.id === 'blur' || node.id === 'grain' })), edges });
    state().groupSelection();
    const group = state().nodes.find(isGroup)!;
    state().setGroupExposed(group.id, exposed);
    return state().nodes.find(isGroup)!;
  };

  it('gives an exposed param a port, which a wire to the card reaches the member through', () => {
    const group = groupOf([{ node: 'blur', key: 'radius' }]);
    const index = group.data.inputs.findIndex((port) => port.node === 'blur' && port.handle === paramPort('radius'));
    expect(index).toBeGreaterThanOrEqual(0);
    expect(group.data.inputs[index].kind).toBe('field');
    expect(realWire(state().nodes, { source: 'lfo', sourceHandle: MOD_OUTPUT, target: group.id, targetHandle: `in-${index}` })).toMatchObject({
      target: 'blur',
      targetHandle: paramPort('radius'),
    });
  });

  it('takes the port away with the param, but not while a wire from outside uses it', () => {
    const group = groupOf([{ node: 'blur', key: 'radius' }, { node: 'grain', key: 'amount' }]);
    state().setGroupExposed(group.id, []);
    const ports = state().nodes.find(isGroup)!.data.inputs.map((port) => [port.node, port.handle]);
    expect(ports).not.toContainEqual(['blur', paramPort('radius')]);
    // The LFO outside still drives the grain's amount.
    expect(ports).toContainEqual(['grain', paramPort('amount')]);
  });

  it('gives no port to a param driven from inside the group', () => {
    const { nodes, edges } = chain();
    useGraph.setState({ nodes: nodes.map((node) => ({ ...node, selected: ['blur', 'grain', 'lfo'].includes(node.id) })), edges });
    state().groupSelection();
    const group = state().nodes.find(isGroup)!;
    state().setGroupExposed(group.id, [{ node: 'grain', key: 'amount' }]);
    const ports = state().nodes.find(isGroup)!.data.inputs.map((port) => [port.node, port.handle]);
    expect(ports).not.toContainEqual(['grain', paramPort('amount')]);
  });
});

describe('exposed inputs', () => {
  /* blur -> blend, with the blend's Layer left empty. */
  const blendGroup = () => {
    const nodes = [effect('blur', 'blur', 0, 0), effect('blend', 'blend', 200, 0)];
    const edges = [wire('e1', 'blur', 'blend')];
    useGraph.setState({ nodes: nodes.map((node) => ({ ...node, selected: true })), edges });
    state().groupSelection();
    return state().nodes.find(isGroup)!;
  };
  const layer = { node: 'blend', key: 'layer', input: true as const };

  it('puts an empty input on the card as a port, which a wire reaches the member through', () => {
    const group = blendGroup();
    expect(group.data.inputs.map((port) => port.handle)).not.toContain('layer');
    state().setGroupExposed(group.id, [layer]);
    const inputs = state().nodes.find(isGroup)!.data.inputs;
    const index = inputs.findIndex((port) => port.node === 'blend' && port.handle === 'layer');
    expect(inputs[index]).toMatchObject({ kind: 'picture', label: 'Blend · Layer' });
    expect(realWire(state().nodes, { source: 'x', sourceHandle: null, target: group.id, targetHandle: `in-${index}` })).toMatchObject({
      target: 'blend',
      targetHandle: 'layer',
    });
    // Taken off the card again, the port goes, and the main input stays.
    state().setGroupExposed(group.id, []);
    const after = state().nodes.find(isGroup)!.data.inputs.map((port) => [port.node, port.handle]);
    expect(after).not.toContainEqual(['blend', 'layer']);
    expect(after).toContainEqual(['blur', null]);
  });

  it('keeps an exposed input through the document and through a preset', () => {
    const group = blendGroup();
    state().setGroupExposed(group.id, [layer]);
    const loaded = deserializeGraph(JSON.parse(JSON.stringify(serializeGraph(state().nodes, state().edges))))!;
    expect(loaded.nodes.find(isGroup)!.data.exposed).toEqual([layer]);

    usePresets.getState().save(state().nodes, state().edges, [group.id]);
    const preset = usePresets.getState().presets[0];
    expect(preset.exposed).toEqual([layer]);
    state().insertPreset(presetGraph(preset)!, preset);
    const inserted = state().nodes.find((node) => isGroup(node) && node.id !== group.id);
    if (!isGroup(inserted)) throw new Error('no preset group');
    const [param] = inserted.data.exposed!;
    expect(param).toMatchObject({ key: 'layer', input: true });
    expect(inserted.data.inputs.some((port) => port.node === param.node && port.handle === 'layer')).toBe(true);
  });
});

describe('renamed exposed entries', () => {
  it('name the port on the card, go back to the module name when cleared, and survive a reload', () => {
    const nodes = [effect('blur', 'blur', 0, 0), effect('blend', 'blend', 200, 0)];
    useGraph.setState({ nodes: nodes.map((node) => ({ ...node, selected: true })), edges: [wire('e1', 'blur', 'blend')] });
    state().groupSelection();
    const group = state().nodes.find(isGroup)!;
    const portFor = (handle: string) => state().nodes.find(isGroup)!.data.inputs.find((port) => port.handle === handle);

    state().setGroupExposed(group.id, [
      { node: 'blend', key: 'layer', input: true, label: 'Background' },
      { node: 'blur', key: 'radius', label: 'Softness' },
    ]);
    expect(portFor('layer')?.label).toBe('Background');
    expect(portFor(paramPort('radius'))?.label).toBe('Softness');

    const loaded = deserializeGraph(JSON.parse(JSON.stringify(serializeGraph(state().nodes, state().edges))))!;
    expect(loaded.nodes.find(isGroup)!.data.exposed!.map((param) => param.label)).toEqual(['Background', 'Softness']);

    state().setGroupExposed(group.id, [{ node: 'blend', key: 'layer', input: true }]);
    expect(portFor('layer')?.label).toBe('Blend · Layer');
  });
});

describe('built-in presets', () => {
  it.each(BUILTIN_PRESETS.map((preset) => [preset.name, preset] as const))('%s reads back as one flow that groups', (_, preset) => {
    const graph = presetGraph(preset);
    expect(graph).not.toBeNull();
    const result = planGroup(graph!.nodes, graph!.edges, graph!.nodes.map((node) => node.id));
    expect('reason' in result).toBe(false);
  });

  it.each(BUILTIN_PRESETS.map((preset) => [preset.name, preset] as const))('%s only exposes params its modules have', (_, preset) => {
    const graph = presetGraph(preset)!;
    for (const param of preset.exposed) {
      const node = graph.nodes.find((candidate) => candidate.id === param.node);
      expect(node?.type).toBe('effect');
      const def = node?.type === 'effect' ? getEffect(node.data.effectId) : undefined;
      expect(def && paramsOf(def).some((spec) => spec.key === param.key)).toBe(true);
    }
  });

  it('are found by id beside the user’s own', () => {
    expect(findPreset('builtin:toon')?.name).toBe('Toon');
    expect(findPreset('no-such-preset')).toBeUndefined();
  });
});
