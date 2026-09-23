import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_VERSION,
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
});
