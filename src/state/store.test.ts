import { describe, expect, it } from 'vitest';
import { useGraph } from './store';

describe('useGraph store video actions', () => {
  it('addVideoNode adds a video node and 2 connected Math nodes for speed and time', () => {
    useGraph.setState({ nodes: [], edges: [] });
    useGraph.getState().addVideoNode({ x: 500, y: 300 });

    const { nodes, edges } = useGraph.getState();
    const videoNode = nodes.find((n) => n.type === 'video');
    expect(videoNode).toBeDefined();
    expect(videoNode?.data.speed).toBe(1);
    expect(videoNode?.data.time).toBe(0);

    const mathNodes = nodes.filter((n) => n.type === 'modulator' && n.data.modulatorId === 'math');
    expect(mathNodes).toHaveLength(2);

    const speedMath = mathNodes.find((m) => m.data.params.op === 2); // Multiply
    expect(speedMath).toBeDefined();
    expect(speedMath?.data.params.a).toBe(1);
    expect(speedMath?.data.params.b).toBe(1);

    const timeMath = mathNodes.find((m) => m.data.params.op === 0); // Add
    expect(timeMath).toBeDefined();
    expect(timeMath?.data.params.a).toBe(0);
    expect(timeMath?.data.params.b).toBe(0);

    const speedEdge = edges.find(
      (e) => e.target === videoNode?.id && e.targetHandle === 'param:speed' && e.source === speedMath?.id,
    );
    expect(speedEdge).toBeDefined();

    const timeEdge = edges.find(
      (e) => e.target === videoNode?.id && e.targetHandle === 'param:time' && e.source === timeMath?.id,
    );
    expect(timeEdge).toBeDefined();
  });

  it('attachMathControls attaches 2 Math nodes to an unwired video node', () => {
    useGraph.setState({
      nodes: [
        {
          id: 'vid-existing',
          type: 'video',
          position: { x: 400, y: 200 },
          data: {
            src: null,
            name: 'clip.mp4',
            width: 1920,
            height: 1080,
            duration: 10,
            speed: 1,
            time: 0,
            loop: true,
            muted: true,
            playbackRate: 1,
          },
        },
      ],
      edges: [],
    });

    useGraph.getState().attachMathControls('vid-existing');

    const { nodes, edges } = useGraph.getState();
    const mathNodes = nodes.filter((n) => n.type === 'modulator' && n.data.modulatorId === 'math');
    expect(mathNodes).toHaveLength(2);

    const speedEdge = edges.find((e) => e.target === 'vid-existing' && e.targetHandle === 'param:speed');
    expect(speedEdge).toBeDefined();

    const timeEdge = edges.find((e) => e.target === 'vid-existing' && e.targetHandle === 'param:time');
    expect(timeEdge).toBeDefined();
  });
});
