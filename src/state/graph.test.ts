import { describe, expect, it } from 'vitest';
import {
  isModulationEdge,
  isParamPort,
  paramPort,
  resolveChain,
  samePort,
  type AppNode,
} from './graph';
import type { Edge } from '@xyflow/react';

describe('graph ports and chain resolution', () => {
  it('correctly identifies param and modulation ports', () => {
    expect(paramPort('rate')).toBe('param:rate');
    expect(isParamPort('param:rate')).toBe(true);
    expect(isParamPort('layer')).toBe(false);
    expect(isParamPort(null)).toBe(false);
    expect(isParamPort(undefined)).toBe(false);

    expect(isModulationEdge({ targetHandle: 'param:mix' })).toBe(true);
    expect(isModulationEdge({ targetHandle: 'layer' })).toBe(false);
    expect(isModulationEdge({ targetHandle: null })).toBe(false);
  });

  it('checks port equality correctly considering null and undefined', () => {
    expect(samePort(null, undefined)).toBe(true);
    expect(samePort(null, null)).toBe(true);
    expect(samePort('param:a', 'param:a')).toBe(true);
    expect(samePort('param:a', 'param:b')).toBe(false);
    expect(samePort('param:a', null)).toBe(false);
  });

  it('detects cycles and returns null when an effect loops to itself', () => {
    const nodes: AppNode[] = [
      {
        id: 'effect-1',
        type: 'effect',
        position: { x: 0, y: 0 },
        data: { effectId: 'levels', params: {} },
      },
      {
        id: 'effect-2',
        type: 'effect',
        position: { x: 100, y: 0 },
        data: { effectId: 'blur', params: {} },
      },
      {
        id: 'output-1',
        type: 'renderOutput',
        position: { x: 200, y: 0 },
        data: { width: 360 },
      },
    ];

    // Cycle: effect-1 -> effect-2 -> effect-1
    const cyclicEdges: Edge[] = [
      { id: 'e1', source: 'effect-1', target: 'effect-2', type: 'link' },
      { id: 'e2', source: 'effect-2', target: 'effect-1', type: 'link' },
      { id: 'e3', source: 'effect-2', target: 'output-1', type: 'link' },
    ];

    const chain = resolveChain(nodes, cyclicEdges, 'output-1');
    expect(chain).toBeNull();
  });

  it('returns null when the viewer is not connected to anything', () => {
    const nodes: AppNode[] = [
      {
        id: 'output-1',
        type: 'renderOutput',
        position: { x: 0, y: 0 },
        data: { width: 360 },
      },
    ];

    const chain = resolveChain(nodes, [], 'output-1');
    expect(chain).toBeNull();
  });
});
