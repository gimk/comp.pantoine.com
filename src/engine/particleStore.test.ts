import { describe, expect, it, beforeEach } from 'vitest';
import { particleManager } from './particleStore';
import { useGraph } from '../state/store';
import { paramPort, type AppNode } from '../state/graph';
import type { Edge } from '@xyflow/react';

describe('ParticleSimulationManager parameter modulation', () => {
  beforeEach(() => {
    particleManager.reset();
  });

  it('updates particle simulation parameters when modulated by a math node', () => {
    const pfNode: AppNode = {
      id: 'pf-1',
      type: 'effect',
      position: { x: 0, y: 0 },
      data: {
        effectId: 'particleFlow',
        params: {
          speed: 1.0,
          angle: 270,
          slowdown: 1.2,
          quantity: 20000,
        },
      },
    };

    // Math node calculating A + B: 2.5 + 0.5 = 3.0
    const mathNode: AppNode = {
      id: 'math-1',
      type: 'modulator',
      position: { x: -200, y: 0 },
      data: {
        modulatorId: 'math',
        params: {
          op: 0, // Add
          a: 2.5,
          b: 0.5,
        },
      },
    };

    // Connect math node to particleFlow's speed port
    const edges: Edge[] = [
      {
        id: 'e1',
        source: 'math-1',
        sourceHandle: 'out',
        target: 'pf-1',
        targetHandle: paramPort('speed'),
      },
    ];

    useGraph.setState({
      nodes: [pfNode, mathNode],
      edges,
    });

    const sim = particleManager.getSimulation('pf-1');
    expect(sim.params.speed).toBe(1.0); // Initially default

    // Step simulation
    particleManager.stepAll(0.016);

    // After stepAll, speed should reflect modulated value 3.0 from math node
    expect(sim.params.speed).toBe(3.0);
  });

  it('updates angle and spread when modulated by a math node', () => {
    const pfNode: AppNode = {
      id: 'pf-2',
      type: 'effect',
      position: { x: 0, y: 0 },
      data: {
        effectId: 'particleFlow',
        params: {
          speed: 1.0,
          angle: 270,
          spread: 0,
        },
      },
    };

    // Math node: op = Multiply, a = 45, b = 2 => 90
    const mathNode: AppNode = {
      id: 'math-2',
      type: 'modulator',
      position: { x: -200, y: 0 },
      data: {
        modulatorId: 'math',
        params: {
          op: 2, // Multiply
          a: 45,
          b: 2,
        },
      },
    };

    const edges: Edge[] = [
      {
        id: 'e2',
        source: 'math-2',
        sourceHandle: 'out',
        target: 'pf-2',
        targetHandle: paramPort('angle'),
      },
    ];

    useGraph.setState({
      nodes: [pfNode, mathNode],
      edges,
    });

    const sim = particleManager.getSimulation('pf-2');
    particleManager.stepAll(0.016);

    expect(sim.params.angle).toBe(90);
  });
});
