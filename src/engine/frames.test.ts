import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import { chainFrames, outputFrameOf, paramPort, resolveChain, type AppNode } from '../state/graph';
import { resizeFrame } from './modules/resize';

const at = { x: 0, y: 0 };
const ramp = (id: string, width = 640, height = 360): AppNode => ({
  id,
  type: 'generator',
  position: at,
  data: { generatorId: 'ramp', width, height, params: {} },
});
const effect = (id: string, effectId: string, params: Record<string, number> = {}): AppNode => ({
  id,
  type: 'effect',
  position: at,
  data: { effectId, params },
});
const viewer: AppNode = { id: 'view', type: 'renderOutput', position: at, data: { width: 360 } };
const edge = (source: string, target: string, targetHandle: string | null = null): Edge => ({
  id: `${source}->${target}:${targetHandle}`,
  source,
  target,
  targetHandle,
});

/** Frames by node id, for the steps that have one. */
const framesById = (nodes: AppNode[], edges: Edge[]) => {
  const chain = resolveChain(nodes, edges, 'view')!;
  const frames = chainFrames(chain);
  const out: Record<string, [number, number]> = {};
  chain.plan.steps.forEach((step, index) => {
    const id = 'nodeId' in step ? step.nodeId : step.kind === 'effect' ? step.pass.nodeId : '';
    const frame = frames[index];
    if (frame) out[id] = [frame.width, frame.height];
  });
  return { out, output: outputFrameOf(chain) };
};

describe('frames', () => {
  it('runs everything in the source frame when nothing resizes', () => {
    const nodes = [ramp('src'), ramp('mask', 100, 100), effect('blur', 'blur'), viewer];
    const edges = [edge('src', 'blur'), edge('mask', 'blur', paramPort('radius')), edge('blur', 'view')];
    const { out, output } = framesById(nodes, edges);
    expect(out.src).toEqual([640, 360]);
    expect(out.blur).toEqual([640, 360]);
    // A picture read on the side is made in its reader's frame, as before.
    expect(out.mask).toEqual([640, 360]);
    expect(output).toEqual({ width: 640, height: 360 });
  });

  it('gives everything after a Resize/Crop its new frame', () => {
    const nodes = [
      ramp('src'),
      effect('crop', 'resize', { mode: 1, aspect: 0 }),
      effect('scan', 'scanlines'),
      ramp('mask', 100, 50),
      viewer,
    ];
    const edges = [
      edge('src', 'crop'),
      edge('crop', 'scan'),
      edge('mask', 'scan', paramPort('darkness')),
      edge('scan', 'view'),
    ];
    const { out, output } = framesById(nodes, edges);
    // The source keeps its own frame: it is what gets cropped.
    expect(out.src).toEqual([640, 360]);
    expect(out.crop).toEqual([360, 360]);
    expect(out.scan).toEqual([360, 360]);
    expect(out.mask).toEqual([360, 360]);
    expect(output).toEqual({ width: 360, height: 360 });
  });

  it('keeps a Resize at the size it chose, even read on the side', () => {
    const nodes = [
      ramp('src'),
      ramp('layer'),
      effect('small', 'resize', { mode: 0, sizeBy: 1, width: 64, height: 64 }),
      effect('blend', 'blend'),
      viewer,
    ];
    const edges = [edge('src', 'blend'), edge('layer', 'small'), edge('small', 'blend', 'layer'), edge('blend', 'view')];
    const { out } = framesById(nodes, edges);
    expect(out.small).toEqual([64, 64]);
    expect(out.blend).toEqual([640, 360]);
  });
});

describe('resizeFrame', () => {
  const hd = { width: 1920, height: 1080 };

  it('resizes by scale, to a size, and to one side with the shape kept', () => {
    expect(resizeFrame(hd, { mode: 0, sizeBy: 0, scale: 0.5 })).toEqual({ width: 960, height: 540 });
    expect(resizeFrame(hd, { mode: 0, sizeBy: 1, width: 1080, height: 1350 })).toEqual({ width: 1080, height: 1350 });
    expect(resizeFrame(hd, { mode: 0, sizeBy: 2, width: 1280 })).toEqual({ width: 1280, height: 720 });
    expect(resizeFrame(hd, { mode: 0, sizeBy: 3, height: 540 })).toEqual({ width: 960, height: 540 });
  });

  it('crops the largest piece of an aspect out of either shape', () => {
    expect(resizeFrame(hd, { mode: 1, aspect: 0 })).toEqual({ width: 1080, height: 1080 });
    expect(resizeFrame(hd, { mode: 1, aspect: 2 })).toEqual({ width: 607.5, height: 1080 });
    expect(resizeFrame({ width: 1080, height: 1920 }, { mode: 1, aspect: 3 })).toEqual({ width: 1080, height: 607.5 });
  });

  it('crops margins, never down to nothing', () => {
    expect(resizeFrame(hd, { mode: 2, left: 0.25, right: 0.25, top: 0, bottom: 0.5 })).toEqual({
      width: 960,
      height: 540,
    });
    const tiny = resizeFrame(hd, { mode: 2, left: 0.9, right: 0.9 });
    expect(tiny.width).toBeCloseTo(1920 * 0.05);
  });
});
