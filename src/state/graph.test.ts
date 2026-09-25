import { describe, expect, it } from 'vitest';
import {
  RENDER_PORT,
  findUpstreamRenderNode,
  hasTargetPort,
  isModulationEdge,
  isParamPort,
  isRenderEdge,
  isRenderPort,
  paramPort,
  resolveChain,
  samePort,
  type AppNode,
} from './graph';
import type { Edge } from '@xyflow/react';

describe('graph ports and chain resolution', () => {
  it('correctly identifies param, modulation, and render ports', () => {
    expect(paramPort('rate')).toBe('param:rate');
    expect(isParamPort('param:rate')).toBe(true);
    expect(isParamPort('layer')).toBe(false);
    expect(isParamPort(null)).toBe(false);
    expect(isParamPort(undefined)).toBe(false);

    expect(isRenderPort(RENDER_PORT)).toBe(true);
    expect(isRenderPort('mod')).toBe(false);
    expect(isRenderPort(null)).toBe(false);

    expect(isModulationEdge({ targetHandle: 'param:mix' })).toBe(true);
    expect(isModulationEdge({ targetHandle: 'layer' })).toBe(false);
    expect(isModulationEdge({ targetHandle: null })).toBe(false);

    expect(isRenderEdge({ sourceHandle: RENDER_PORT, targetHandle: null })).toBe(true);
    expect(isRenderEdge({ sourceHandle: null, targetHandle: RENDER_PORT })).toBe(true);
    expect(isRenderEdge({ sourceHandle: null, targetHandle: null })).toBe(false);
  });

  it('verifies target port capability per node type', () => {
    const viewerNode: AppNode = { id: 'v1', type: 'renderOutput', position: { x: 0, y: 0 }, data: { width: 360 } };
    expect(hasTargetPort(viewerNode, null)).toBe(true); // Blue live WebGL
    expect(hasTargetPort(viewerNode, RENDER_PORT)).toBe(true); // Purple baked asset
    expect(hasTargetPort(viewerNode, 'param:test')).toBe(false);

    const backgroundNode: AppNode = { id: 'bg1', type: 'backgroundOutput', position: { x: 0, y: 0 }, data: { enabled: true, fit: 'fill', opacity: 1 } };
    expect(hasTargetPort(backgroundNode, null)).toBe(true); // Blue live WebGL
    expect(hasTargetPort(backgroundNode, RENDER_PORT)).toBe(true); // Purple baked asset
    expect(hasTargetPort(backgroundNode, 'param:test')).toBe(false);

    const renderNode: AppNode = { id: 'r1', type: 'render', position: { x: 0, y: 0 }, data: { format: 'mp4', quality: 0.9, scale: 1, time: 0, duration: 3, fps: 30 } };
    expect(hasTargetPort(renderNode, null)).toBe(true); // Blue live picture input
    expect(hasTargetPort(renderNode, RENDER_PORT)).toBe(false);

    const exportNode: AppNode = { id: 'e1', type: 'export', position: { x: 0, y: 0 }, data: { filenamePrefix: '' } };
    expect(hasTargetPort(exportNode, RENDER_PORT)).toBe(true); // Purple baked asset input
    expect(hasTargetPort(exportNode, null)).toBe(false); // Does not take raw WebGL directly
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

  it('resolves a chain targeting an export or formatter node as sink and passes through as tap', () => {
    const nodes: AppNode[] = [
      {
        id: 'image-1',
        type: 'image',
        position: { x: 0, y: 0 },
        data: { src: 'blob:test', name: 'photo.jpg', width: 100, height: 100 },
      },
      {
        id: 'render-1',
        type: 'render',
        position: { x: 200, y: 0 },
        data: {
          format: 'gif',
          quality: 0.9,
          scale: 0.5,
          time: 0,
          duration: 3,
          fps: 15,
          loopPreview: true,
        },
      },
      {
        id: 'formatter-1',
        type: 'formatter',
        position: { x: 300, y: 0 },
        data: {
          format: 'gif',
          quality: 0.9,
          scale: 0.5,
          time: 0,
          duration: 3,
          fps: 15,
          loopPreview: true,
        },
      },
      {
        id: 'export-1',
        type: 'export',
        position: { x: 400, y: 0 },
        data: {
          filenamePrefix: 'test',
        },
      },
      {
        id: 'output-1',
        type: 'renderOutput',
        position: { x: 600, y: 0 },
        data: { width: 360 },
      },
    ];

    const edges: Edge[] = [
      { id: 'e1', source: 'image-1', target: 'render-1', type: 'link' },
      { id: 'e2', source: 'render-1', target: 'formatter-1', type: 'link' },
      { id: 'e3', source: 'formatter-1', target: 'export-1', type: 'link' },
      { id: 'e4', source: 'export-1', target: 'output-1', type: 'link' },
    ];

    // Render, Formatter and Export nodes resolve upstream without throwing
    const exportChain = resolveChain(nodes, edges, 'export-1');
    const outputChain = resolveChain(nodes, edges, 'output-1');
    const formatterChain = resolveChain(nodes, edges, 'formatter-1');
    const renderChain = resolveChain(nodes, edges, 'render-1');

    expect(exportChain).toBeNull(); // image-1 bitmap not loaded in imageStore mock
    expect(outputChain).toBeNull();
    expect(formatterChain).toBeNull();
    expect(renderChain).toBeNull();
  });

  it('walks backwards through pass-through viewers to find upstream render node', () => {
    const nodes: AppNode[] = [
      {
        id: 'render-1',
        type: 'render',
        position: { x: 0, y: 0 },
        data: { format: 'mp4', quality: 0.9, scale: 1, time: 0, duration: 3, fps: 30 },
      },
      {
        id: 'viewer-1',
        type: 'renderOutput',
        position: { x: 200, y: 0 },
        data: { width: 360 },
      },
      {
        id: 'viewer-2',
        type: 'renderOutput',
        position: { x: 400, y: 0 },
        data: { width: 360 },
      },
      {
        id: 'export-1',
        type: 'export',
        position: { x: 600, y: 0 },
        data: { filenamePrefix: '' },
      },
    ];

    // Chain: render-1 =(render)=> viewer-1 =(render)=> viewer-2 =(render)=> export-1
    const edges: Edge[] = [
      { id: 'e1', source: 'render-1', sourceHandle: RENDER_PORT, target: 'viewer-1', targetHandle: RENDER_PORT, type: 'link' },
      { id: 'e2', source: 'viewer-1', sourceHandle: RENDER_PORT, target: 'viewer-2', targetHandle: RENDER_PORT, type: 'link' },
      { id: 'e3', source: 'viewer-2', sourceHandle: RENDER_PORT, target: 'export-1', targetHandle: RENDER_PORT, type: 'link' },
    ];

    expect(findUpstreamRenderNode(nodes, edges, 'export-1')?.id).toBe('render-1');
    expect(findUpstreamRenderNode(nodes, edges, 'viewer-2')?.id).toBe('render-1');
    expect(findUpstreamRenderNode(nodes, edges, 'viewer-1')?.id).toBe('render-1');
    expect(findUpstreamRenderNode(nodes, edges, 'render-1')).toBeNull();
  });

  it('walks backwards through viewers connected via single dual-color input (targetHandle: null)', () => {
    const nodes: AppNode[] = [
      {
        id: 'render-1',
        type: 'render',
        position: { x: 0, y: 0 },
        data: { format: 'mp4', quality: 0.9, scale: 1, time: 0, duration: 3, fps: 30 },
      },
      {
        id: 'viewer-1',
        type: 'renderOutput',
        position: { x: 200, y: 0 },
        data: { width: 360 },
      },
      {
        id: 'export-1',
        type: 'export',
        position: { x: 400, y: 0 },
        data: { filenamePrefix: '' },
      },
    ];

    // Single dual port on viewer: targetHandle is null/undefined
    const edges: Edge[] = [
      { id: 'e1', source: 'render-1', sourceHandle: RENDER_PORT, target: 'viewer-1', targetHandle: null, type: 'link' },
      { id: 'e2', source: 'viewer-1', sourceHandle: null, target: 'export-1', targetHandle: RENDER_PORT, type: 'link' },
    ];

    expect(findUpstreamRenderNode(nodes, edges, 'viewer-1')?.id).toBe('render-1');
    expect(findUpstreamRenderNode(nodes, edges, 'export-1')?.id).toBe('render-1');
  });

  it('walks backwards through backgroundOutput pass-through nodes to find upstream render node', () => {
    const nodes: AppNode[] = [
      {
        id: 'render-1',
        type: 'render',
        position: { x: 0, y: 0 },
        data: { format: 'mp4', quality: 0.9, scale: 1, time: 0, duration: 3, fps: 30 },
      },
      {
        id: 'bg-1',
        type: 'backgroundOutput',
        position: { x: 200, y: 0 },
        data: { enabled: true, fit: 'fill', opacity: 1 },
      },
      {
        id: 'viewer-1',
        type: 'renderOutput',
        position: { x: 400, y: 0 },
        data: { width: 360 },
      },
    ];

    const edges: Edge[] = [
      { id: 'e1', source: 'render-1', sourceHandle: RENDER_PORT, target: 'bg-1', targetHandle: RENDER_PORT, type: 'link' },
      { id: 'e2', source: 'bg-1', sourceHandle: RENDER_PORT, target: 'viewer-1', targetHandle: RENDER_PORT, type: 'link' },
    ];

    expect(findUpstreamRenderNode(nodes, edges, 'bg-1')?.id).toBe('render-1');
    expect(findUpstreamRenderNode(nodes, edges, 'viewer-1')?.id).toBe('render-1');
  });
});
