import type { XYPosition } from '@xyflow/react';
import { registry } from '../engine/registry';
import { modulatorRegistry, type ModulatorDef } from '../engine/modulators';
import { CATEGORY_LABELS, CATEGORY_ORDER, type Category, type EffectDef } from '../engine/effects';
import { useGraph } from '../state/store';
import { findPreset, presetGraph } from '../state/presets';
import { mediaKindOf, paletteDropOffset, type PaletteItem } from './paletteDrag';

export type CatalogEntry = { key: string; label: string; payload: PaletteItem; tag?: string };
export type CatalogGroup = { heading?: string; entries: CatalogEntry[] };
export type CatalogFolder = { id: 'input' | 'module' | 'output'; label: string; groups: CatalogGroup[] };

const modulatorEntry = (def: ModulatorDef): CatalogEntry => ({
  key: `modulator:${def.id}`,
  label: def.label,
  payload: { kind: 'modulator', modulatorId: def.id },
});

// Empty categories are dropped, so no heading ever shows with nothing under
// it while the module set is still filling out.
const effectGroups = (): CatalogGroup[] => {
  const byCategory = new Map<Category, EffectDef[]>();
  for (const def of registry) {
    if (def.category === 'generator') continue;
    const existing = byCategory.get(def.category);
    if (existing) existing.push(def);
    else byCategory.set(def.category, [def]);
  }
  return CATEGORY_ORDER.filter((category) => category !== 'generator').flatMap((category) => {
    const defs = byCategory.get(category);
    if (!defs) return [];
    return [
      {
        heading: CATEGORY_LABELS[category],
        entries: defs.map((def) => ({
          key: `effect:${def.id}`,
          label: def.label,
          payload: { kind: 'effect', effectId: def.id } as const,
          /* A function means "animated at some settings" -- the tag marks
             what can move, not what happens to be moving. */
          tag: def.animated !== false ? 'animated' : undefined,
        })),
      },
    ];
  });
};

/**
 * Everything that can go on the canvas, split the way the graph is: what
 * comes in, what happens in the middle, what comes out.
 *
 * Modulation sources count as inputs: like an image, they have an output and
 * nothing going in. Operators, which take signals in, sit with the modules.
 * Built from the registries, so a new effect or modulator shows up in the
 * toolbar and in the Shift+A menu the moment it is registered.
 */
export const catalog: CatalogFolder[] = [
  {
    id: 'input',
    label: 'Input',
    groups: [
      {
        heading: 'Picture',
        entries: [
          { key: 'image', label: 'Image', payload: { kind: 'image' } },
          { key: 'video', label: 'Video', payload: { kind: 'video' } },
        ],
      },
      {
        heading: 'Generated Media',
        entries: [
          { key: 'generator:ramp', label: 'Ramp', payload: { kind: 'generator', generatorId: 'ramp' } },
          { key: 'generator:noise', label: 'Noise', payload: { kind: 'generator', generatorId: 'noise' }, tag: 'animated' },
        ],
      },
      {
        heading: 'Modulation',
        entries: modulatorRegistry.filter((def) => def.role === 'source').map(modulatorEntry),
      },
    ],
  },
  {
    id: 'module',
    label: 'Module',
    groups: [
      ...effectGroups(),
      {
        heading: 'Math',
        entries: modulatorRegistry.filter((def) => def.role === 'operator').map(modulatorEntry),
      },
    ],
  },
  {
    id: 'output',
    label: 'Output',
    groups: [
      {
        entries: [
          { key: 'output', label: 'Viewer', payload: { kind: 'output' } },
          { key: 'background', label: 'Background', payload: { kind: 'background' } },
          { key: 'render', label: 'Render', payload: { kind: 'render' } },
          { key: 'export', label: 'Exporter', payload: { kind: 'export' } },
        ],
      },
    ],
  },
];

/**
 * Files from outside the app -- dropped or pasted -- each become the module
 * that reads it, already loaded. With a point, they land side by side from
 * there, the first one carried by its title bar as a palette drop would be;
 * without, each takes its default spot. Files neither module reads are
 * passed over. Returns how many were placed.
 */
export const addMediaFiles = (files: Iterable<File>, at?: XYPosition): number => {
  const store = useGraph.getState();
  let placed = 0;
  for (const file of files) {
    const kind = mediaKindOf(file);
    if (!kind) continue;
    const offset = paletteDropOffset({ kind });
    const position = at && { x: at.x - offset.x + placed * 220, y: at.y - offset.y };
    placed += 1;
    if (kind === 'image') void store.loadImage(store.addImageNode(position), file);
    else void store.loadVideo(store.addVideoNode(position), file);
  }
  return placed;
};

/** Put one on the canvas: at `position` if given, else at its default spot. */
export const addPaletteItem = (item: PaletteItem, position?: XYPosition): void => {
  const store = useGraph.getState();
  if (item.kind === 'effect') store.addEffectNode(item.effectId, position);
  else if (item.kind === 'generator') store.addGeneratorNode(item.generatorId, position);
  else if (item.kind === 'modulator') store.addModulatorNode(item.modulatorId, position);
  else if (item.kind === 'image') store.addImageNode(position);
  else if (item.kind === 'video') store.addVideoNode(position);
  else if (item.kind === 'render') store.addRenderNode(position);
  else if (item.kind === 'export') store.addExportNode(position);
  else if (item.kind === 'background') store.addBackgroundNode(position);
  else if (item.kind === 'preset') {
    const preset = findPreset(item.presetId);
    const graph = preset && presetGraph(preset);
    if (graph) store.insertPreset(graph, { name: preset.name, exposed: preset.exposed }, position);
  }
  else store.addOutputNode(position);
};
