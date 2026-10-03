import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import { MOD_OUTPUT, chainIsAnimated, fieldOpDerived, hasTargetPort, outputIsField, paramPort, resolveChain, wireKind, type AppNode } from './graph';
import { buildFragmentSource } from '../engine/effects';
import { getEffect } from '../engine/registry';
import { convertSignal, fieldOperatorBody, math, mapRange } from '../engine/modulators';
import { summarize } from '../engine/statistics';

const at = { x: 0, y: 0 };
const ramp = (id: string): AppNode => ({
  id,
  type: 'generator',
  position: at,
  data: { generatorId: 'ramp', width: 640, height: 360, params: {} },
});
const effect = (id: string, effectId: string): AppNode => ({ id, type: 'effect', position: at, data: { effectId, params: {} } });
const mod = (id: string, modulatorId: string, params: Record<string, number | boolean> = {}): AppNode => ({
  id,
  type: 'modulator',
  position: at,
  data: { modulatorId, params },
});
const viewer: AppNode = { id: 'view', type: 'renderOutput', position: at, data: { width: 360 } };
const edge = (source: string, target: string, targetHandle: string | null = null, sourceHandle: string | null = null): Edge => ({
  id: `${source}->${target}:${targetHandle}`,
  source,
  target,
  sourceHandle,
  targetHandle,
});

describe('fields: pictures wired into params', () => {
  it('binds a picture wired into a param as a field of that step', () => {
    const nodes = [ramp('src'), ramp('mask'), effect('blur', 'blur'), viewer];
    const edges = [edge('src', 'blur'), edge('mask', 'blur', paramPort('radius')), edge('blur', 'view')];
    const chain = resolveChain(nodes, edges, 'view')!;
    const blur = chain.plan.steps.find((step) => step.kind === 'effect')!;
    expect(blur.kind === 'effect' && blur.fields).toEqual([{ key: 'radius', step: 1 }]);
    expect(wireKind(nodes, edges, edges[1])).toBe('field');
  });

  it('runs a Math per pixel once a picture reaches one of its ports', () => {
    const nodes = [ramp('src'), ramp('mask'), mod('times', 'math', { op: 2, a: 0, b: 0 }), mod('lfo', 'lfo', { rate: 1, amplitude: 1 }), effect('blur', 'blur'), viewer];
    const edges = [
      edge('src', 'blur'),
      edge('mask', 'times', paramPort('a')),
      edge('lfo', 'times', paramPort('b'), MOD_OUTPUT),
      edge('times', 'blur', paramPort('radius'), MOD_OUTPUT),
      edge('blur', 'view'),
    ];
    expect(outputIsField(nodes, edges, 'times')).toBe(true);
    expect(outputIsField(nodes, edges, 'lfo')).toBe(false);
    const chain = resolveChain(nodes, edges, 'view')!;
    const op = chain.plan.steps.find((step) => step.kind === 'fieldOp');
    expect(op?.kind).toBe('fieldOp');
    if (op?.kind !== 'fieldOp') return;
    expect('step' in op.ports.a).toBe(true);
    expect('signal' in op.ports.b).toBe(true);
    // The LFO on B keeps the frame loop running.
    expect(chainIsAnimated(chain)).toBe(true);
  });

  it('gives Map Range the 0..1 of a picture as its Auto range', () => {
    const nodes = [ramp('src'), ramp('mask'), mod('map', 'map', { auto: true, toMin: 0, toMax: 40 }), effect('blur', 'blur'), viewer];
    const edges = [
      edge('src', 'blur'),
      edge('mask', 'map', paramPort('x')),
      edge('map', 'blur', paramPort('radius'), MOD_OUTPUT),
      edge('blur', 'view'),
    ];
    const op = resolveChain(nodes, edges, 'view')!.plan.steps.find((step) => step.kind === 'fieldOp');
    expect(op?.kind === 'fieldOp' && [op.params.fromMin, op.params.fromMax]).toEqual([0, 1]);
    // The card shows the same From range, so it can lock those knobs.
    expect(fieldOpDerived(nodes, edges, 'map')).toEqual({ fromMin: 0, fromMax: 1 });
    // With Auto range off, From is the user's again.
    const manual = nodes.map((node) =>
      node.id === 'map' ? mod('map', 'map', { auto: false, toMin: 0, toMax: 40 }) : node,
    );
    expect(fieldOpDerived(manual, edges, 'map')).toEqual({});
  });

  it('leaves a field on a round port unused, and marks the wire invalid', () => {
    const nodes = [ramp('src'), ramp('mask'), mod('times', 'math', { op: 2 }), mod('lfo', 'lfo'), effect('scan', 'scanlines'), viewer];
    const edges = [
      edge('src', 'scan'),
      edge('mask', 'times', paramPort('a')),
      edge('times', 'lfo', paramPort('rate'), MOD_OUTPUT),
      edge('lfo', 'scan', paramPort('darkness'), MOD_OUTPUT),
      edge('times', 'scan', paramPort('roll'), MOD_OUTPUT),
      edge('scan', 'view'),
    ];
    expect(wireKind(nodes, edges, edges[2])).toBe('invalid');
    expect(wireKind(nodes, edges, edges[4])).toBe('invalid');
    expect(wireKind(nodes, edges, edges[3])).toBe('signal');
    const chain = resolveChain(nodes, edges, 'view')!;
    const scan = chain.plan.steps.find((step) => step.kind === 'effect');
    if (scan?.kind !== 'effect') throw new Error('no effect step');
    expect(scan.fields).toEqual([]);
    expect(Object.keys(scan.pass.modulation)).toEqual(['darkness']);
    // The LFO's rate treats the field as unwired.
    expect(scan.pass.modulation.darkness.inputs.rate).toBeUndefined();
  });

  it('turns a single number into a flat picture where a picture goes', () => {
    const nodes = [mod('v', 'value', { value: 0.5 }), viewer];
    const edges = [edge('v', 'view', null, MOD_OUTPUT)];
    const chain = resolveChain(nodes, edges, 'view')!;
    expect(chain.plan.steps.map((step) => step.kind)).toEqual(['fill']);
    expect(chain.sourceNodeId).toBe('v');
  });

  it('measures an Image Statistic before the step that reads it', () => {
    const nodes = [ramp('src'), ramp('probe'), mod('stat', 'statistic'), effect('blur', 'blur'), viewer];
    const edges = [
      edge('src', 'blur'),
      edge('probe', 'stat'),
      edge('stat', 'blur', paramPort('radius'), MOD_OUTPUT),
      edge('blur', 'view'),
    ];
    expect(hasTargetPort(nodes[2], null)).toBe(true);
    expect(hasTargetPort(mod('m', 'math'), null)).toBe(false);
    const kinds = resolveChain(nodes, edges, 'view')!.plan.steps.map((step) => step.kind);
    expect(kinds.indexOf('statistic')).toBeLessThan(kinds.indexOf('effect'));
    expect(kinds.indexOf('statistic')).toBeGreaterThan(kinds.lastIndexOf('generator'));
  });

  it('resolves an Image Statistic on its own, to its picture measured', () => {
    const nodes = [ramp('probe'), effect('blur', 'blur'), mod('stat', 'statistic')];
    const edges = [edge('probe', 'blur'), edge('blur', 'stat')];
    const chain = resolveChain(nodes, edges, 'stat')!;
    expect(chain.plan.steps.map((step) => step.kind)).toEqual(['generator', 'effect', 'statistic']);
    expect(chain.plan.output).toBe(1);
    expect(chain.sourceNodeId).toBe('probe');
    // Nothing wired in: nothing to measure.
    expect(resolveChain([mod('stat', 'statistic')], [], 'stat')).toBeNull();
    // Only a statistic: any other modulator is still no viewer.
    expect(resolveChain([ramp('src'), mod('m', 'math')], [edge('src', 'm', paramPort('a'))], 'm')).toBeNull();
  });

  it('lets every module param take a wire', () => {
    expect(hasTargetPort(effect('d', 'dither'), paramPort('monochrome'))).toBe(true);
    expect(hasTargetPort(effect('d', 'dither'), paramPort('matrix'))).toBe(true);
  });
});

describe('field conversions', () => {
  it('converts a number into other socket types as Blender does', () => {
    const dither = getEffect('dither')!;
    const spec = (key: string) => dither.params.find((p) => p.key === key)!;
    expect(convertSignal(spec('monochrome'), 0.2)).toBe(true);
    expect(convertSignal(spec('monochrome'), 0)).toBe(false);
    expect(convertSignal(spec('levels'), 7.9)).toBe(7);
    expect(convertSignal({ kind: 'color', key: 'c', label: 'C', default: [0, 0, 0] }, 0.3)).toEqual([0.3, 0.3, 0.3]);
  });

  it('builds a module shader whose fielded param is read per pixel', () => {
    const blur = getEffect('blur')!;
    const plain = buildFragmentSource(blur, 0);
    const fielded = buildFragmentSource(blur, 0, ['radius']);
    expect(plain).toContain('uniform float u_radius;');
    expect(fielded).not.toContain('uniform float u_radius;');
    expect(fielded).toContain('uniform sampler2D u_radius_field;');
    expect(fielded).toMatch(/u_radius = max\(luma\(texture\(u_radius_field, v_uv\)\.rgb\), 0\.0\);/);
  });

  it('declares every Math and Map Range port for its field shader', () => {
    expect(fieldOperatorBody(math).uniforms).toContain('uniform sampler2D u_a_field;');
    expect(fieldOperatorBody(math).uniforms).toContain('uniform int u_op;');
    expect(fieldOperatorBody(mapRange).body).toContain('vec3 p_toMax');
  });

  it('summarizes luminance, skipping transparent samples', () => {
    const [mean, min, max, range] = summarize([255, 255, 255, 255, 0, 0, 0, 255, 9, 9, 9, 0], 255);
    expect(mean).toBeCloseTo(0.5);
    expect(min).toBe(0);
    expect(max).toBeCloseTo(1);
    expect(range).toBeCloseTo(1);
  });
});
