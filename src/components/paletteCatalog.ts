import type { XYPosition } from '@xyflow/react';
import { registry } from '../engine/registry';
import { modulatorRegistry, type ModulatorDef } from '../engine/modulators';
import { CATEGORY_LABELS, CATEGORY_ORDER, type Category, type EffectDef } from '../engine/effects';
import { useGraph } from '../state/store';
import type { PaletteItem } from './paletteDrag';

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
    const existing = byCategory.get(def.category);
    if (existing) existing.push(def);
    else byCategory.set(def.category, [def]);
  }
  return CATEGORY_ORDER.flatMap((category) => {
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
      { heading: 'Picture', entries: [{ key: 'image', label: 'Image', payload: { kind: 'image' } }] },
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
          { key: 'render', label: 'Render', payload: { kind: 'render' } },
          { key: 'export', label: 'Exporter', payload: { kind: 'export' } },
        ],
      },
    ],
  },
];

/** Put one on the canvas: at `position` if given, else at its default spot. */
export const addPaletteItem = (item: PaletteItem, position?: XYPosition): void => {
  const store = useGraph.getState();
  if (item.kind === 'effect') store.addEffectNode(item.effectId, position);
  else if (item.kind === 'modulator') store.addModulatorNode(item.modulatorId, position);
  else if (item.kind === 'image') store.addImageNode(position);
  else if (item.kind === 'render') store.addRenderNode(position);
  else if (item.kind === 'formatter') store.addFormatterNode(position);
  else if (item.kind === 'export') store.addExportNode(position);
  else store.addOutputNode(position);
};
