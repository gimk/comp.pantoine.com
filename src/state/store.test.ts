import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { RENDER_PORT, type AppNode, type ModulatorNodeData, type RenderNodeData } from './graph';
import { useGraph } from './store';
import { commitNow, redo, undo } from './history';
import { useRenderJobs } from './renderJobs';
import { getVideo, putVideo } from '../engine/videoStore';
import { getImage } from '../engine/imageStore';
import { readStatistic, setStatistics } from '../engine/statistics';

/*
 * The tests run without a DOM. A video element is only ever poked at for its
 * playback flags here, so a plain object stands in for one.
 */
type FakeVideo = { loop: boolean; playbackRate: number; paused: boolean; src: string } & Record<string, unknown>;
const fakeVideo = (): FakeVideo => {
  const video: FakeVideo = {
    loop: true,
    playbackRate: 1,
    paused: false,
    src: '',
    muted: true,
    pause: () => {
      video.paused = true;
    },
    play: () => {
      video.paused = false;
      return Promise.resolve();
    },
    load: () => {},
    removeAttribute: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return video;
};

beforeAll(() => {
  const scope = globalThis as { document?: unknown };
  if (!scope.document) scope.document = { createElement: () => fakeVideo() };
});

const at = { x: 0, y: 0 };
const renderData: RenderNodeData = { format: 'mp4', quality: 0.9, scale: 1, time: 0, duration: 3, fps: 30 };

const graph = (nodes: AppNode[], edges: Edge[] = []): void => {
  useGraph.setState({ nodes, edges, insertTargetEdgeId: null });
};

const nodeById = (id: string): AppNode | undefined => useGraph.getState().nodes.find((node) => node.id === id);

const withVideo = (id: string): FakeVideo => {
  const element = fakeVideo();
  putVideo(id, element as unknown as HTMLVideoElement, 'blob:' + id, id + '.mp4', 16, 9, 2);
  return element;
};

afterEach(() => {
  commitNow();
});

describe('useGraph store video actions', () => {
  it('addVideoNode adds a lone video node', () => {
    graph([]);
    useGraph.getState().addVideoNode({ x: 500, y: 300 });

    const { nodes, edges } = useGraph.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('video');
    expect(nodes[0].type === 'video' && nodes[0].data.speed).toBe(1);
    expect(edges).toHaveLength(0);
  });

  /* Older documents still carry a Math helper wired into each video's speed. */
  const videoWithHelper = (): { video: AppNode; helper: Node<ModulatorNodeData, 'modulator'>; edges: Edge[] } => {
    const video: AppNode = {
      id: 'video-h',
      type: 'video',
      position: at,
      data: { src: null, name: '', width: 0, height: 0, duration: 0, speed: 1, loop: true, muted: true, playbackRate: 1 },
    };
    const helper: Node<ModulatorNodeData, 'modulator'> = {
      id: 'math-h',
      type: 'modulator',
      position: at,
      data: { modulatorId: 'math', params: { op: 2, a: 1, b: 1 }, helperFor: video.id },
    };
    const edges: Edge[] = [
      { id: 'e-h', source: helper.id, sourceHandle: 'mod', target: video.id, targetHandle: 'param:speed', type: 'link' },
    ];
    graph([helper, video], edges);
    return { video, helper, edges };
  };

  it('deleting a video takes its untouched speed helper along, and pauses it', () => {
    const { video } = videoWithHelper();
    const element = withVideo(video.id);
    useGraph.getState().removeNodes([video.id]);
    expect(useGraph.getState().nodes).toHaveLength(0);
    expect(useGraph.getState().edges).toHaveLength(0);
    expect(element.paused).toBe(true);
  });

  it('keeps a speed helper the user has wired to something else', () => {
    const { video, helper, edges } = videoWithHelper();
    const other: AppNode = { id: 'fx-x', type: 'effect', position: at, data: { effectId: 'blend', params: {} } };
    graph(
      [helper, video, other],
      [...edges, { id: 'e-x', source: helper.id, sourceHandle: 'mod', target: 'fx-x', targetHandle: 'param:mix' }],
    );
    useGraph.getState().onNodesChange([{ type: 'remove', id: video.id }]);
    expect(nodeById(helper.id)).toBeDefined();
    expect(nodeById(video.id)).toBeUndefined();
  });
});

describe('splicing and lifting', () => {
  const chain = (): void =>
    graph(
      [
        { id: 'ramp-a', type: 'generator', position: at, data: { generatorId: 'ramp', width: 64, height: 64, params: {} } },
        { id: 'fx-1', type: 'effect', position: at, data: { effectId: 'blend', params: {} } },
        { id: 'view-b', type: 'renderOutput', position: at, data: { width: 300 } },
        { id: 'rnd-c', type: 'render', position: at, data: { ...renderData } },
        { id: 'view-d', type: 'renderOutput', position: at, data: { width: 300 } },
        { id: 'view-e', type: 'renderOutput', position: at, data: { width: 300 } },
      ],
      [
        { id: 'pic', source: 'ramp-a', target: 'view-b' },
        { id: 'baked', source: 'rnd-c', sourceHandle: RENDER_PORT, target: 'view-d' },
        { id: 'relay', source: 'view-d', target: 'view-e' },
      ],
    );

  it('splices an effect into a picture wire', () => {
    chain();
    useGraph.getState().insertNodeOnEdge('fx-1', 'pic');
    const edges = useGraph.getState().edges;
    expect(edges.find((edge) => edge.id === 'pic')).toBeUndefined();
    expect(edges.some((edge) => edge.source === 'ramp-a' && edge.target === 'fx-1')).toBe(true);
    expect(edges.some((edge) => edge.source === 'fx-1' && edge.target === 'view-b')).toBe(true);
  });

  it('refuses to splice into a wire carrying a baked file', () => {
    chain();
    const before = useGraph.getState().edges;
    useGraph.getState().insertNodeOnEdge('fx-1', 'baked');
    useGraph.getState().insertNodeOnEdge('fx-1', 'relay');
    expect(useGraph.getState().edges).toBe(before);
  });

  it('lifts an effect out and closes the gap', () => {
    chain();
    useGraph.getState().insertNodeOnEdge('fx-1', 'pic');
    useGraph.getState().detachFromChain(['fx-1']);
    const edges = useGraph.getState().edges;
    expect(edges.some((edge) => edge.source === 'ramp-a' && edge.target === 'view-b')).toBe(true);
    expect(edges.some((edge) => edge.source === 'fx-1' || edge.target === 'fx-1')).toBe(false);
  });

  it('refuses a connection that would close a loop', () => {
    graph([
      { id: 'v1', type: 'renderOutput', position: at, data: { width: 300 } },
      { id: 'v2', type: 'renderOutput', position: at, data: { width: 300 } },
    ]);
    useGraph.getState().onConnect({ source: 'v1', target: 'v2', sourceHandle: null, targetHandle: null });
    useGraph.getState().onConnect({ source: 'v2', target: 'v1', sourceHandle: null, targetHandle: null });
    expect(useGraph.getState().edges).toHaveLength(1);
  });
});

describe('removing, copying and pasting', () => {
  it('clears a Render node’s job when the node is removed', () => {
    graph([{ id: 'rnd-1', type: 'render', position: at, data: { ...renderData } }]);
    useRenderJobs.getState().start('rnd-1', new AbortController());
    expect(useRenderJobs.getState().jobs['rnd-1']).toBeDefined();
    useGraph.getState().removeNodes(['rnd-1']);
    expect(useRenderJobs.getState().jobs['rnd-1']).toBeUndefined();

    graph([{ id: 'rnd-2', type: 'render', position: at, data: { ...renderData } }]);
    useRenderJobs.getState().start('rnd-2', new AbortController());
    useGraph.getState().onNodesChange([{ type: 'remove', id: 'rnd-2' }]);
    expect(useRenderJobs.getState().jobs['rnd-2']).toBeUndefined();
  });

  it('duplicates a render node with its recipe and nothing of its job', () => {
    graph([{ id: 'rnd-3', type: 'render', position: at, data: { ...renderData, format: 'gif', fps: 20 }, selected: true }]);
    useRenderJobs.getState().start('rnd-3', new AbortController());
    useGraph.getState().duplicateSelection({ x: 10, y: 10 });
    const copy = useGraph.getState().nodes.find((node) => node.id !== 'rnd-3')!;
    expect(copy.type).toBe('render');
    expect(copy.data).toEqual({ ...renderData, format: 'gif', fps: 20 });
    expect(useRenderJobs.getState().jobs[copy.id]).toBeUndefined();
    useRenderJobs.getState().clear('rnd-3');
  });

  it('gives each copy of a video an element of its own', () => {
    const video: AppNode = {
      id: 'video-9',
      type: 'video',
      position: at,
      data: { src: 'blob:video-9', name: 'a', width: 16, height: 9, duration: 2, loop: false, speed: 2 },
      selected: true,
    };
    graph([video]);
    const original = withVideo('video-9');
    original.loop = false;
    original.playbackRate = 2;

    useGraph.getState().duplicateSelection({ x: 10, y: 10 });
    const duplicate = useGraph.getState().nodes.find((node) => node.id !== 'video-9')!;
    const copied = getVideo(duplicate.id)!.element as unknown as FakeVideo;
    expect(copied).not.toBe(original);
    expect(copied.loop).toBe(false);
    expect(copied.playbackRate).toBe(2);

    // A change to the copy stays on the copy.
    useGraph.getState().setVideoData(duplicate.id, { loop: true });
    expect(original.loop).toBe(false);

    // And the same through the clipboard.
    graph([{ ...video, selected: true }]);
    expect(useGraph.getState().copySelection()).toBe(true);
    useGraph.getState().paste();
    const pasted = useGraph.getState().nodes.find((node) => node.id !== 'video-9')!;
    expect(getVideo(pasted.id)!.element).not.toBe(original);
    expect(getVideo('video-9')!.element).toBe(original);
  });

  it('leaves the original element with the original on an Alt-drag', () => {
    graph([
      { id: 'video-7', type: 'video', position: at, data: { src: 'blob:x', name: '', width: 1, height: 1, duration: 1 } },
    ]);
    const original = withVideo('video-7');
    useGraph.getState().beginAltDuplicate(['video-7']);
    const rename = useGraph.getState().endAltDuplicate();
    const copyId = rename('video-7');
    expect(copyId).not.toBe('video-7');
    expect(getVideo('video-7')!.element).toBe(original);
    expect(getVideo(copyId)!.element).not.toBe(original);
  });
});

describe('store updates that change nothing', () => {
  it('leaves the node array alone for an identical render patch, and clamps for the format', () => {
    graph([{ id: 'rnd-5', type: 'render', position: at, data: { ...renderData, fps: 60, duration: 90 } }]);
    const before = useGraph.getState().nodes;
    useGraph.getState().setRenderData('rnd-5', { fps: 60 });
    expect(useGraph.getState().nodes).toBe(before);

    useGraph.getState().setRenderData('rnd-5', { format: 'gif' });
    const data = nodeById('rnd-5')!.data as RenderNodeData;
    expect(data.fps).toBe(30);
    expect(data.duration).toBe(30);
  });

  it('sets several params in one change', () => {
    graph([{ id: 'fx-9', type: 'effect', position: at, data: { effectId: 'blend', params: { mix: 0 } } }]);
    let updates = 0;
    const stop = useGraph.subscribe(() => {
      updates += 1;
    });
    useGraph.getState().setEffectParams('fx-9', { mix: 0.5, mode: 2 });
    useGraph.getState().setEffectParams('fx-9', { mix: 0.5 });
    stop();
    expect(updates).toBe(1);
    expect((nodeById('fx-9')!.data as { params: Record<string, unknown> }).params).toEqual({ mix: 0.5, mode: 2 });
  });
});

describe('loading files', () => {
  it('ignores a load that finishes after a newer one, or after its node is gone', async () => {
    const closed: string[] = [];
    const pending: ((bitmap: ImageBitmap) => void)[] = [];
    const scope = globalThis as { createImageBitmap?: unknown };
    const previous = scope.createImageBitmap;
    scope.createImageBitmap = () => new Promise<ImageBitmap>((resolve) => pending.push(resolve));
    const bitmap = (name: string) => ({ width: 2, height: 2, close: () => closed.push(name) }) as unknown as ImageBitmap;

    try {
      graph([{ id: 'image-1', type: 'image', position: at, data: { src: null, name: '', width: 0, height: 0 } }]);
      const first = useGraph.getState().loadImage('image-1', new File(['a'], 'first.png'));
      const second = useGraph.getState().loadImage('image-1', new File(['b'], 'second.png'));
      pending[1](bitmap('second'));
      await second;
      pending[0](bitmap('first'));
      await first;
      expect((nodeById('image-1')!.data as { name: string }).name).toBe('second.png');
      expect(closed).toEqual(['first']);

      const third = useGraph.getState().loadImage('image-1', new File(['c'], 'third.png'));
      useGraph.getState().removeNodes(['image-1']);
      pending[2](bitmap('third'));
      await third;
      expect(getImage('image-1')).toBeUndefined();
      // Removing the node freed the second picture; the late third is never stored.
      expect(closed).toEqual(['first', 'second', 'third']);
    } finally {
      scope.createImageBitmap = previous;
    }
  });
});

describe('undo and redo', () => {
  it('steps back and forward through committed changes', () => {
    graph([{ id: 'out-1', type: 'renderOutput', position: at, data: { width: 300 } }]);
    commitNow();
    useGraph.getState().addRenderNode(at);
    commitNow();
    const rendered = useGraph.getState().nodes.find((node) => node.type === 'render')!;
    useRenderJobs.getState().start(rendered.id, new AbortController());

    undo();
    expect(useGraph.getState().nodes.map((node) => node.id)).toEqual(['out-1']);
    // Undoing the node out of the graph takes its job with it.
    expect(useRenderJobs.getState().jobs[rendered.id]).toBeUndefined();

    redo();
    expect(nodeById(rendered.id)?.type).toBe('render');
  });

  it('never brings transient render data back', () => {
    const stale = { ...renderData, renderedBlob: { size: 1 }, renderedUrl: 'blob:stale', progress: null };
    graph([{ id: 'rnd-8', type: 'render', position: at, data: stale as RenderNodeData }]);
    commitNow();
    useGraph.getState().setRenderData('rnd-8', { fps: 24 });
    commitNow();
    undo();
    const data = nodeById('rnd-8')!.data as Record<string, unknown>;
    expect(data.fps).toBe(30);
    expect('renderedBlob' in data).toBe(false);
    expect('renderedUrl' in data).toBe(false);
  });

  it('re-applies a video’s playback settings on undo', () => {
    graph([
      { id: 'video-5', type: 'video', position: at, data: { src: 'blob:v5', name: '', width: 1, height: 1, duration: 1, loop: true, speed: 1 } },
    ]);
    const element = withVideo('video-5');
    commitNow();
    useGraph.getState().setVideoData('video-5', { loop: false, speed: 4 });
    commitNow();
    expect(element.loop).toBe(false);
    undo();
    expect(element.loop).toBe(true);
    expect(element.playbackRate).toBe(1);
  });
});

describe('deleting an Image Statistic', () => {
  it('lets go of the readings it kept', () => {
    graph([{ id: 'stat-1', type: 'modulator', position: at, data: { modulatorId: 'statistic', params: { statistic: 0 } } }]);
    setStatistics('stat-1', [0.7, 0.7, 0.7, 0.7, 0.7], 1);
    useGraph.getState().onNodesChange([{ type: 'remove', id: 'stat-1' }]);
    expect(readStatistic('stat-1', 0)).toBe(0);
  });
});
