import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import type { ModulatorNodeData } from './graph';
import { useGraph } from './store';

describe('useGraph store video actions', () => {
  it('addVideoNode adds a video node and a connected Math node for speed', () => {
    useGraph.setState({ nodes: [], edges: [] });
    useGraph.getState().addVideoNode({ x: 500, y: 300 });

    const { nodes, edges } = useGraph.getState();
    const videoNode = nodes.find((n) => n.type === 'video');
    expect(videoNode).toBeDefined();
    expect(videoNode?.data.speed).toBe(1);

    const mathNodes = nodes.filter(
      (n): n is Node<ModulatorNodeData, 'modulator'> => n.type === 'modulator' && n.data.modulatorId === 'math',
    );
    expect(mathNodes).toHaveLength(1);

    const speedMath = mathNodes.find((m) => m.data.params.op === 2); // Multiply
    expect(speedMath).toBeDefined();
    expect(speedMath?.data.params.a).toBe(1);
    expect(speedMath?.data.params.b).toBe(1);

    const speedEdge = edges.find(
      (e) => e.target === videoNode?.id && e.targetHandle === 'param:speed' && e.source === speedMath?.id,
    );
    expect(speedEdge).toBeDefined();
  });
});
