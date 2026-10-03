/**
 * Presets that ship with the app, beside the user's own.
 *
 * Each is built here from ordinary modules and wires and put through the
 * same `serializeGraph` a saved preset goes through, so a built-in is in
 * the current document format by construction rather than by a hand-kept
 * blob of JSON that drifts as the format moves on.
 *
 * They are never stored and cannot be edited or removed. Placing one gives
 * a group like any preset; changing it and saving makes the user's own.
 */
import type { Edge } from '@xyflow/react';
import { defaultParams, type ParamValue } from '../engine/effects';
import { getEffect } from '../engine/registry';
import { getGenerator } from '../engine/generators';
import { serializeGraph } from './document';
import type { AppNode, ExposedParam } from './graph';
import type { Preset } from './presets';

/** The prefix that keeps a built-in's id clear of any the user's presets get. */
export const BUILTIN_PREFIX = 'builtin:';

const effectNode = (id: string, effectId: string, x: number, params: Record<string, ParamValue>): AppNode => {
  const def = getEffect(effectId);
  if (!def) throw new Error(`Built-in preset names an unknown module "${effectId}"`);
  return { id, type: 'effect', position: { x, y: 0 }, data: { effectId, params: { ...defaultParams(def), ...params } } };
};

const generatorNode = (id: string, generatorId: string, x: number, y: number, params: Record<string, ParamValue>): AppNode => {
  const def = getGenerator(generatorId);
  if (!def) throw new Error(`Built-in preset names an unknown generator "${generatorId}"`);
  return {
    id,
    type: 'generator',
    position: { x, y },
    data: { generatorId, width: 1280, height: 720, params: { ...defaultParams(def), ...params } },
  };
};

const wire = (source: string, target: string, targetHandle: string | null = null): Edge => ({
  id: `${source}-${target}${targetHandle ? `-${targetHandle}` : ''}`,
  source,
  target,
  sourceHandle: null,
  targetHandle,
  type: 'link',
});

const preset = (id: string, name: string, nodes: AppNode[], edges: Edge[], exposed: ExposedParam[]): Preset => ({
  id: BUILTIN_PREFIX + id,
  name,
  graph: serializeGraph(nodes, edges),
  exposed,
});

/** A straight chain of modules, each into the next. */
const chainPreset = (id: string, name: string, nodes: AppNode[], exposed: ExposedParam[]): Preset =>
  preset(
    id,
    name,
    nodes,
    nodes.slice(1).map((node, i) => wire(nodes[i].id, node.id)),
    exposed,
  );

/*
 * Toon: smooth out the noise, band the colours, then ink the lines. The
 * edges are found on the banded picture, so they fall on the borders
 * between flat areas -- which is what makes it read as cel shading rather
 * than a photo with outlines.
 */
const toon = chainPreset(
  'toon',
  'Toon',
  [
    effectNode('blur', 'blur', 0, { radius: 1.5 }),
    effectNode('bands', 'posterize', 240, { levels: 5, mode: 0 }),
    effectNode('ink', 'edgeDetect', 480, { mode: 3, sensitivity: 3, thickness: 1.2, edgeColor: [0, 0, 0] }),
  ],
  [
    { node: 'bands', key: 'levels', label: 'Bands' },
    { node: 'ink', key: 'sensitivity', label: 'Line Sensitivity' },
    { node: 'ink', key: 'thickness', label: 'Line Thickness' },
    { node: 'ink', key: 'edgeColor', label: 'Line Color' },
    { node: 'blur', key: 'radius', label: 'Smoothing' },
  ],
);

/*
 * Slit-Scan: a Ramp tells Time Machine how far back each pixel reads, so
 * one side of the frame is now and the other Spread seconds ago -- moving
 * things stretch and bend across it. Direction turns the ramp, and with
 * it the axis time runs along.
 */
const slitScan = preset(
  'slit-scan',
  'Slit-Scan',
  [
    effectNode('time', 'timeMachine', 240, { blackOffset: 0, whiteOffset: 1.5, blend: true }),
    // Black to white, so the delay runs evenly from Base Delay to Spread.
    generatorNode('sweep', 'ramp', 0, 220, {
      type: 0,
      angle: 0,
      interpolation: 0,
      stopCount: 2,
      pos0: 0,
      color0: [0, 0, 0],
      pos1: 1,
      color1: [1, 1, 1],
    }),
  ],
  [wire('sweep', 'time', 'timeMap')],
  [
    { node: 'time', key: 'whiteOffset', label: 'Spread (s)' },
    { node: 'sweep', key: 'angle', label: 'Direction' },
    { node: 'time', key: 'blackOffset', label: 'Base Delay (s)' },
  ],
);

export const BUILTIN_PRESETS: Preset[] = [toon, slitScan];
