import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_VERSION,
  autosaveBlocked,
  loadGraph,
  saveGraph,
  deserializeGraph,
  highestIdSuffix,
  serializeGraph,
} from './document';
import type { AppNode } from './graph';
import type { Edge } from '@xyflow/react';

describe('document serialization & deserialization', () => {
  it('correctly calculates the highest id suffix', () => {
    const ids = ['image-1', 'effect-12', 'edge-3', 'output-99', 'no-suffix', 'invalid-abc'];
    expect(highestIdSuffix(ids)).toBe(99);
    expect(highestIdSuffix([])).toBe(0);
  });

  it('round-trips a valid graph through serialization and deserialization', () => {
    const nodes: AppNode[] = [
      {
        id: 'image-1',
        type: 'image',
        position: { x: 50, y: 100 },
        data: { src: 'blob:http://localhost/test', name: 'photo.jpg', width: 1920, height: 1080 },
      },
      {
        id: 'levels-2',
        type: 'effect',
        position: { x: 300, y: 100 },
        data: { effectId: 'levels', params: { brightness: 0.1, contrast: 1.2, gamma: 1.0 } },
      },
      {
        id: 'output-3',
        type: 'renderOutput',
        position: { x: 600, y: 100 },
        data: { width: 400 },
      },
    ];

    const edges: Edge[] = [
      { id: 'edge-1', source: 'image-1', target: 'levels-2', type: 'link' },
      { id: 'edge-2', source: 'levels-2', target: 'output-3', type: 'link' },
    ];

    const serialized = serializeGraph(nodes, edges);
    expect(serialized.version).toBe(DOCUMENT_VERSION);
    expect(serialized.nodes).toHaveLength(3);
    expect(serialized.edges).toHaveLength(2);

    const deserialized = deserializeGraph(serialized);
    expect(deserialized).not.toBeNull();
    expect(deserialized!.nodes).toHaveLength(3);
    expect(deserialized!.edges).toHaveLength(2);

    // Bitmap URL is dropped upon reload by design, but name and dimensions are preserved
    const restoredImage = deserialized!.nodes.find((n) => n.id === 'image-1');
    expect(restoredImage?.data).toEqual({
      src: null,
      name: 'photo.jpg',
      width: 1920,
      height: 1080,
    });
  });

  it('round-trips a video node through serialization and deserialization', () => {
    const nodes: AppNode[] = [
      {
        id: 'video-1',
        type: 'video',
        position: { x: 50, y: 100 },
        data: {
          src: 'blob:http://localhost/video',
          name: 'clip.mp4',
          width: 1280,
          height: 720,
          duration: 15.5,
          speed: 2,
          loop: false,
          muted: true,
          playbackRate: 2,
        },
      },
    ];
    const serialized = serializeGraph(nodes, []);
    const deserialized = deserializeGraph(serialized);
    expect(deserialized).not.toBeNull();
    const restoredVideo = deserialized!.nodes.find((n) => n.id === 'video-1');
    expect(restoredVideo).toBeDefined();
    expect(restoredVideo?.type).toBe('video');
    expect(restoredVideo?.data).toEqual({
      src: null,
      name: 'clip.mp4',
      width: 1280,
      height: 720,
      duration: 15.5,
      speed: 2,
      loop: false,
      muted: true,
      playbackRate: 2,
    });
  });

  it('safely rejects corrupt or invalid graph payloads', () => {
    expect(deserializeGraph(null)).toBeNull();
    expect(deserializeGraph(undefined)).toBeNull();
    expect(deserializeGraph('not an object')).toBeNull();
    expect(deserializeGraph({ version: 999, nodes: [], edges: [] })).toBeNull();
    expect(deserializeGraph({ version: DOCUMENT_VERSION, nodes: 'invalid' })).toBeNull();
  });

  it('filters out edges that point to non-existent nodes', () => {
    const raw = {
      version: DOCUMENT_VERSION,
      nodes: [
        { id: 'image-1', type: 'image', position: { x: 0, y: 0 }, name: '', width: 0, height: 0 },
      ],
      edges: [
        { id: 'edge-ghost', source: 'image-1', target: 'ghost-node' },
      ],
    };

    const deserialized = deserializeGraph(raw);
    expect(deserialized).not.toBeNull();
    expect(deserialized!.nodes).toHaveLength(1);
    expect(deserialized!.edges).toHaveLength(0);
  });

  it('serializes and deserializes render nodes correctly and migrates legacy formatter nodes', () => {
    const nodes: AppNode[] = [
      {
        id: 'render-1',
        type: 'render',
        position: { x: 400, y: 200 },
        data: {
          format: 'gif',
          quality: 0.85,
          scale: 0.5,
          time: 2.5,
          duration: 4,
          fps: 20,
          loopPreview: true,
        },
      },
      {
        id: 'export-1',
        type: 'export',
        position: { x: 650, y: 200 },
        data: {
          filenamePrefix: 'my_clip',
        },
      },
    ];

    const serialized = serializeGraph(nodes, []);
    expect(serialized.nodes[0]).toEqual({
      id: 'render-1',
      type: 'render',
      position: { x: 400, y: 200 },
      format: 'gif',
      quality: 0.85,
      scale: 0.5,
      time: 2.5,
      duration: 4,
      fps: 20,
      loopPreview: true,
    });
    expect(serialized.nodes[1]).toEqual({
      id: 'export-1',
      type: 'export',
      position: { x: 650, y: 200 },
      filenamePrefix: 'my_clip',
    });

    const deserialized = deserializeGraph(serialized);
    expect(deserialized).not.toBeNull();
    expect(deserialized!.nodes[0]).toEqual({
      id: 'render-1',
      type: 'render',
      position: { x: 400, y: 200 },
      data: {
        format: 'gif',
        quality: 0.85,
        scale: 0.5,
        time: 2.5,
        duration: 4,
        fps: 20,
        loopPreview: true,
      },
    });

    // Test legacy formatter migration
    const legacyPayload = {
      version: DOCUMENT_VERSION,
      nodes: [
        {
          id: 'old-formatter',
          type: 'formatter',
          position: { x: 100, y: 100 },
          format: 'mp4',
          quality: 0.9,
          scale: 1,
          time: 0,
          duration: 3,
          fps: 30,
        },
      ],
      edges: [],
    };
    const legacyDeserialized = deserializeGraph(legacyPayload);
    expect(legacyDeserialized).not.toBeNull();
    const migratedNode = legacyDeserialized!.nodes[0];
    expect(migratedNode.type).toBe('render');
    if (migratedNode.type === 'render') {
      expect(migratedNode.data.format).toBe('mp4');
    }
  });

  it('serializes and deserializes backgroundOutput nodes correctly', () => {
    const nodes: AppNode[] = [
      {
        id: 'bg-1',
        type: 'backgroundOutput',
        position: { x: 500, y: 150 },
        data: {
          enabled: true,
          fit: 'fill',
          opacity: 0.85,
        },
      },
    ];

    const serialized = serializeGraph(nodes, []);
    expect(serialized.nodes[0]).toEqual({
      id: 'bg-1',
      type: 'backgroundOutput',
      position: { x: 500, y: 150 },
      enabled: true,
      fit: 'fill',
      opacity: 0.85,
    });

    const deserialized = deserializeGraph(serialized);
    expect(deserialized).not.toBeNull();
    expect(deserialized!.nodes[0]).toEqual({
      id: 'bg-1',
      type: 'backgroundOutput',
      position: { x: 500, y: 150 },
      data: {
        enabled: true,
        fit: 'fill',
        opacity: 0.85,
      },
    });

    // Test legacy 'cover' / 'contain' migration
    const legacy = {
      version: 1,
      nodes: [
        { id: 'bg-legacy-1', type: 'backgroundOutput', position: { x: 0, y: 0 }, fit: 'cover' },
        { id: 'bg-legacy-2', type: 'backgroundOutput', position: { x: 0, y: 0 }, fit: 'contain' },
      ],
      edges: [],
    };
    const migrated = deserializeGraph(legacy);
    expect((migrated!.nodes[0] as AppNode & { type: 'backgroundOutput' }).data.fit).toBe('fill');
    expect((migrated!.nodes[1] as AppNode & { type: 'backgroundOutput' }).data.fit).toBe('fit');
  });

  it('round-trips generator nodes (Ramp and Noise) with parameters and resolution', () => {
    const nodes: AppNode[] = [
      {
        id: 'ramp-1',
        type: 'generator',
        position: { x: 100, y: 100 },
        data: {
          generatorId: 'ramp',
          width: 1920,
          height: 1080,
          params: { type: 2, angle: 90, stopCount: 4 },
        },
      },
      {
        id: 'noise-2',
        type: 'generator',
        position: { x: 350, y: 100 },
        data: {
          generatorId: 'noise',
          width: 1280,
          height: 720,
          params: { noiseType: 0, harmonics: 4, speed: 0.5 },
        },
      },
      {
        id: 'out-1',
        type: 'renderOutput',
        position: { x: 600, y: 100 },
        data: { width: 360 },
      },
    ];

    const edges: Edge[] = [
      { id: 'e1', source: 'ramp-1', target: 'out-1', type: 'link' },
    ];

    const serialized = serializeGraph(nodes, edges);
    expect(serialized.nodes).toHaveLength(3);
    const serializedRamp = serialized.nodes.find((n) => n.id === 'ramp-1');
    expect(serializedRamp?.type).toBe('generator');

    const deserialized = deserializeGraph(serialized);
    expect(deserialized).not.toBeNull();
    const restoredRamp = deserialized!.nodes.find((n) => n.id === 'ramp-1');
    expect(restoredRamp?.type).toBe('generator');
    if (restoredRamp?.type === 'generator') {
      expect(restoredRamp.data.generatorId).toBe('ramp');
      expect(restoredRamp.data.width).toBe(1920);
      expect(restoredRamp.data.height).toBe(1080);
      expect(restoredRamp.data.params.type).toBe(2);
      expect(restoredRamp.data.params.angle).toBe(90);
      expect(restoredRamp.data.params.stopCount).toBe(4);
    }
    const restoredNoise = deserialized!.nodes.find((n) => n.id === 'noise-2');
    expect(restoredNoise?.type).toBe('generator');
    if (restoredNoise?.type === 'generator') {
      expect(restoredNoise.data.generatorId).toBe('noise');
      expect(restoredNoise.data.width).toBe(1280);
      expect(restoredNoise.data.height).toBe(720);
      expect(restoredNoise.data.params.harmonics).toBe(4);
    }
  });
});

describe('document versions and repair', () => {
  it('reads a version 2 document, migrating formatter nodes, and writes the current version', () => {
    const v2 = {
      version: 2,
      nodes: [
        { id: 'ramp-1', type: 'generator', position: { x: 0, y: 0 }, generatorId: 'ramp', width: 640, height: 360, params: {} },
        { id: 'fmt-2', type: 'formatter', position: { x: 0, y: 0 }, format: 'gif', quality: 0.8, scale: 1, time: 0, duration: 2, fps: 15 },
        { id: 'video-3', type: 'video', position: { x: 0, y: 0 }, name: 'clip.mp4', width: 1, height: 1, duration: 4 },
      ],
      edges: [{ id: 'e1', source: 'ramp-1', target: 'fmt-2' }],
    };
    const loaded = deserializeGraph(v2);
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes.map((node) => node.type)).toEqual(['generator', 'render', 'video']);
    expect(loaded!.edges).toHaveLength(1);
    expect(DOCUMENT_VERSION).toBe(5);
    expect(serializeGraph(loaded!.nodes, loaded!.edges).version).toBe(5);
    expect(deserializeGraph({ version: 1, nodes: [], edges: [] })).not.toBeNull();
  });

  it('refuses a document from a newer build', () => {
    expect(deserializeGraph({ version: DOCUMENT_VERSION + 1, nodes: [], edges: [] })).toBeNull();
  });

  it('keeps the first of two nodes sharing an id, and one wire per input', () => {
    const loaded = deserializeGraph({
      version: 3,
      nodes: [
        { id: 'out-1', type: 'renderOutput', position: { x: 0, y: 0 }, width: 300 },
        { id: 'out-1', type: 'renderOutput', position: { x: 50, y: 50 }, width: 500 },
        { id: 'ramp-2', type: 'generator', position: { x: 0, y: 0 }, generatorId: 'ramp', width: 64, height: 64 },
        { id: 'ramp-3', type: 'generator', position: { x: 0, y: 0 }, generatorId: 'ramp', width: 64, height: 64 },
      ],
      edges: [
        { id: 'e1', source: 'ramp-2', target: 'out-1' },
        { id: 'e2', source: 'ramp-3', target: 'out-1' },
        { id: 'e1', source: 'ramp-3', target: 'out-1' },
      ],
    });
    expect(loaded!.nodes).toHaveLength(3);
    const out = loaded!.nodes.find((node) => node.id === 'out-1');
    expect(out?.type === 'renderOutput' && out.data.width).toBe(300);
    expect(loaded!.edges.map((edge) => edge.id)).toEqual(['e1']);
  });

  it('puts out-of-range values back to something sensible', () => {
    const loaded = deserializeGraph({
      version: 3,
      nodes: [
        { id: 'r', type: 'render', position: { x: 0, y: 0 }, format: 'gif', quality: 5, scale: -1, time: -3, duration: 0, fps: 900 },
        { id: 'v', type: 'video', position: { x: 0, y: 0 }, name: '', width: 0, height: 0, duration: 0, speed: -2, playbackRate: 1000 },
        { id: 'g', type: 'generator', position: { x: 0, y: 0 }, generatorId: 'ramp', width: 0, height: 1e9, params: {} },
        { id: 'u', type: 'generator', position: { x: 0, y: 0 }, generatorId: 'gone', width: 10, height: 10, params: { junk: 'x' } },
      ],
      edges: [],
    });
    const [r, v, g, u] = loaded!.nodes;
    if (r.type !== 'render' || v.type !== 'video' || g.type !== 'generator' || u.type !== 'generator') {
      throw new Error('unexpected node types');
    }
    expect(r.data.quality).toBe(1);
    expect(r.data.scale).toBe(1);
    expect(r.data.time).toBe(0);
    expect(r.data.duration).toBe(3);
    expect(r.data.fps).toBe(30);
    expect(v.data.speed).toBe(1);
    expect(v.data.playbackRate).toBe(16);
    expect(g.data.width).toBe(1280);
    expect(g.data.height).toBe(8192);
    expect(u.data.params).toEqual({});
  });

  it('loads a looped graph by dropping the wire that closes the loop', () => {
    const loaded = deserializeGraph({
      version: 2,
      nodes: [
        { id: 'a', type: 'renderOutput', position: { x: 0, y: 0 }, width: 300 },
        { id: 'b', type: 'renderOutput', position: { x: 0, y: 0 }, width: 300 },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'a' },
      ],
    });
    expect(loaded!.nodes).toHaveLength(2);
    expect(loaded!.edges.map((edge) => edge.id)).toEqual(['e1']);
  });

  it('drops a saved wire the editor would refuse, whatever order the wires are in', () => {
    const loaded = deserializeGraph({
      version: 3,
      nodes: [
        { id: 'r', type: 'render', position: { x: 0, y: 0 }, format: 'png', quality: 0.9, scale: 1, time: 0, duration: 3, fps: 30 },
        { id: 'v', type: 'renderOutput', position: { x: 0, y: 0 }, width: 300 },
        { id: 'x', type: 'export', position: { x: 0, y: 0 }, filenamePrefix: 'comp' },
        { id: 'fx', type: 'effect', position: { x: 0, y: 0 }, effectId: 'blur', params: {} },
      ],
      edges: [
        // Listed downstream-first: the viewer only carries a baked file
        // because of the wire after it.
        { id: 'toExport', source: 'v', target: 'x', targetHandle: 'render' },
        { id: 'toViewer', source: 'r', target: 'v', sourceHandle: 'render' },
        // A baked file into an effect's picture input is never allowed.
        { id: 'toEffect', source: 'r', target: 'fx', sourceHandle: 'render' },
      ],
    });
    expect(loaded!.nodes).toHaveLength(4);
    expect(loaded!.edges.map((edge) => edge.id).sort()).toEqual(['toExport', 'toViewer']);
  });

  it('round-trips a speed helper mark, and drops one naming no video', () => {
    const loaded = deserializeGraph({
      version: 3,
      nodes: [
        { id: 'video-1', type: 'video', position: { x: 0, y: 0 }, name: '', width: 0, height: 0, duration: 0 },
        { id: 'math-2', type: 'modulator', position: { x: 0, y: 0 }, modulatorId: 'math', params: {}, helperFor: 'video-1' },
        { id: 'math-3', type: 'modulator', position: { x: 0, y: 0 }, modulatorId: 'math', params: {}, helperFor: 'nobody' },
      ],
      edges: [],
    });
    const [, kept, dropped] = loaded!.nodes;
    expect(kept.type === 'modulator' && kept.data.helperFor).toBe('video-1');
    expect(dropped.type === 'modulator' && dropped.data.helperFor).toBeUndefined();
    expect(serializeGraph(loaded!.nodes, []).nodes[1]).toMatchObject({ helperFor: 'video-1' });
  });

  it('does not autosave over a document from a newer build', () => {
    const storage = new Map<string, string>();
    const newer = JSON.stringify({ version: DOCUMENT_VERSION + 1, nodes: [], edges: [] });
    storage.set('comp.graph', newer);
    const previous = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    };
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(loadGraph()).toBeNull();
      expect(autosaveBlocked()).toBe(true);
      saveGraph([], []);
      expect(storage.get('comp.graph')).toBe(newer);
    } finally {
      console.warn = warn;
      (globalThis as { localStorage?: unknown }).localStorage = previous;
    }
  });
});
