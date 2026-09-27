import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import { isValidConnection, wouldCreateCycle } from './connections';
import { MOD_OUTPUT, RENDER_PORT, paramPort, type AppNode } from './graph';

const at = { x: 0, y: 0 };
const nodes: AppNode[] = [
  { id: 'img', type: 'image', position: at, data: { src: null, name: '', width: 0, height: 0 } },
  { id: 'fx1', type: 'effect', position: at, data: { effectId: 'blend', params: {} } },
  { id: 'fx2', type: 'effect', position: at, data: { effectId: 'blend', params: {} } },
  { id: 'lfo', type: 'modulator', position: at, data: { modulatorId: 'math', params: {} } },
  { id: 'rnd', type: 'render', position: at, data: { format: 'mp4', quality: 1, scale: 1, time: 0, duration: 1, fps: 30 } },
  { id: 'vA', type: 'renderOutput', position: at, data: { width: 360 } },
  { id: 'vB', type: 'renderOutput', position: at, data: { width: 360 } },
  { id: 'exp', type: 'export', position: at, data: { filenamePrefix: '' } },
];
const wire = (source: string, target: string, targetHandle: string | null = null, sourceHandle: string | null = null) => ({
  source,
  target,
  sourceHandle,
  targetHandle,
});

describe('connection rules', () => {
  it('refuses a wire that would close a viewer <-> viewer loop', () => {
    const edges: Edge[] = [{ id: 'e1', source: 'vA', target: 'vB' }];
    expect(isValidConnection(nodes, edges, wire('vB', 'vA'))).toBe(false);
    expect(isValidConnection(nodes, [], wire('vB', 'vA'))).toBe(true);
  });

  it('refuses loops through effects, and self-wires', () => {
    const edges: Edge[] = [
      { id: 'e1', source: 'img', target: 'fx1' },
      { id: 'e2', source: 'fx1', target: 'fx2' },
    ];
    expect(isValidConnection(nodes, edges, wire('fx2', 'fx1', 'layer'))).toBe(false);
    expect(isValidConnection(nodes, edges, wire('fx1', 'fx1', 'layer'))).toBe(false);
    expect(wouldCreateCycle(edges, wire('fx2', 'fx1', 'layer'))).toBe(true);
  });

  it('ignores the wire a new one is about to replace', () => {
    // fx2 -> fx1 is a loop only through fx1 -> fx2's port, which the new wire takes over.
    const edges: Edge[] = [{ id: 'e1', source: 'fx1', target: 'fx2' }];
    expect(wouldCreateCycle(edges, wire('img', 'fx2'))).toBe(false);
    expect(wouldCreateCycle(edges, wire('fx2', 'fx1'))).toBe(true);
  });

  it('keeps signals and pictures apart', () => {
    expect(isValidConnection(nodes, [], wire('lfo', 'fx1', paramPort('mix'), MOD_OUTPUT))).toBe(true);
    expect(isValidConnection(nodes, [], wire('lfo', 'fx1', null, MOD_OUTPUT))).toBe(false);
    expect(isValidConnection(nodes, [], wire('img', 'fx1', paramPort('mix')))).toBe(false);
  });

  it('sends baked files only where a baked file can go', () => {
    const fed: Edge[] = [{ id: 'e1', source: 'rnd', target: 'vA', sourceHandle: RENDER_PORT }];
    // An exporter takes a render, or a viewer showing one, and nothing live.
    expect(isValidConnection(nodes, [], wire('rnd', 'exp', RENDER_PORT))).toBe(true);
    expect(isValidConnection(nodes, fed, wire('vA', 'exp', RENDER_PORT))).toBe(true);
    expect(isValidConnection(nodes, [], wire('img', 'exp', RENDER_PORT))).toBe(false);
    // An effect takes nothing baked, however it arrives.
    expect(isValidConnection(nodes, [], wire('rnd', 'fx1'))).toBe(false);
    expect(isValidConnection(nodes, fed, wire('vA', 'fx1'))).toBe(false);
    expect(isValidConnection(nodes, [], wire('vA', 'fx1'))).toBe(true);
    // A viewer takes either.
    expect(isValidConnection(nodes, [], wire('rnd', 'vB'))).toBe(true);
    expect(isValidConnection(nodes, [], wire('img', 'vB'))).toBe(true);
  });
});
