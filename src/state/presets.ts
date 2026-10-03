/**
 * Presets: a flow of modules kept under a name, to be put back as a group.
 *
 * A preset is a macro, not a live node. It holds the modules and the wires
 * among them in the document's own saved form, and putting one on the
 * canvas stamps out fresh copies of them, grouped -- the store's
 * `insertPreset`. Nothing about the renderer knows presets exist. It also
 * holds which of the modules' params the group shows on its card.
 *
 * Like the document, a preset holds no pixels: an image module in one comes
 * back empty, naming the file it wants.
 *
 * Presets are the user's own, kept in local storage beside the document but
 * not in it, so they outlive any one graph and are not undone by Ctrl+Z.
 */
import { create } from 'zustand';
import type { Edge } from '@xyflow/react';
import type { AppNode, ExposedParam } from './graph';
import { deserializeGraph, readExposed, serializeGraph, type SerializedGraph } from './document';
import { TOO_FEW, isGroup, planGroup } from './groups';

export type Preset = { id: string; name: string; graph: SerializedGraph; exposed: ExposedParam[] };

/** What a preset is called and shows, as the save dialog edits them. */
export type PresetSettings = { name: string; exposed: ExposedParam[] };

/**
 * What saving these nodes as a preset would keep, or why it cannot.
 *
 * The same rule as grouping, since a preset comes back as a group: at least
 * two modules, wired into one flow. A selected group stands for its members,
 * and gives the preset its name and the params it shows. Only the wires
 * among the members are kept; whatever fed the flow from outside is not
 * part of it.
 */
export const capturePreset = (
  nodes: AppNode[],
  edges: Edge[],
  ids: string[],
): (PresetSettings & { graph: SerializedGraph; groupId?: string }) | { reason: string } => {
  const result = planGroup(nodes, edges, ids);
  if ('reason' in result) {
    return {
      reason:
        result.reason === TOO_FEW
          ? 'Select a group, or at least two modules, to save as a preset'
          : 'Only modules wired together in one flow can be saved as a preset',
    };
  }
  const members = new Set(result.plan.data.members);
  const kept = nodes
    .filter((node) => members.has(node.id))
    .map((node) => {
      const shown = { ...node };
      delete shown.hidden;
      return shown;
    });
  const groups = nodes.filter((node) => ids.includes(node.id) && isGroup(node));
  const group = groups.length === 1 && isGroup(groups[0]) ? groups[0] : undefined;
  return {
    name: group?.data.name ?? 'Preset',
    exposed: group?.data.exposed?.filter((param) => members.has(param.node)) ?? [],
    graph: serializeGraph(
      kept,
      edges.filter((edge) => members.has(edge.source) && members.has(edge.target)),
    ),
    ...(group ? { groupId: group.id } : {}),
  };
};

/** A preset's modules and wires, read back as checked as any document is. */
export const presetGraph = (preset: Preset): { nodes: AppNode[]; edges: Edge[] } | null =>
  deserializeGraph(preset.graph);

const STORAGE_KEY = 'comp.presets';

const readPreset = (value: unknown): Preset[] => {
  const preset = value as Partial<Preset> | null;
  if (!preset || typeof preset.id !== 'string' || typeof preset.name !== 'string') return [];
  if (!preset.graph || typeof preset.graph !== 'object') return [];
  return [{ id: preset.id, name: preset.name, graph: preset.graph, exposed: readExposed(preset.exposed) }];
};

const load = (): Preset[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.flatMap(readPreset) : [];
  } catch {
    return [];
  }
};

const store = (presets: Preset[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // A private window or a full quota: the preset lasts as long as the tab.
  }
};

/** A name not already taken: "Glow", then "Glow 2", "Glow 3". */
const freeName = (presets: Preset[], name: string): string => {
  const taken = new Set(presets.map((preset) => preset.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} ${n}`)) n += 1;
  return `${name} ${n}`;
};

/**
 * What the preset dialog is open on: the selection, about to be saved as a
 * new preset, or a preset already saved, being edited.
 */
export type PresetDraft = { kind: 'new'; ids: string[] } | { kind: 'edit'; presetId: string };

type PresetStore = {
  presets: Preset[];
  draft: PresetDraft | null;
  /** Open the dialog on the selection; why it cannot be saved, if it cannot. */
  openSave: (nodes: AppNode[], edges: Edge[]) => string | null;
  openEdit: (id: string) => void;
  closeDraft: () => void;
  /** Save the given nodes as a preset; its id, or why it could not be. */
  save: (nodes: AppNode[], edges: Edge[], ids: string[], settings?: PresetSettings) => { id: string } | { reason: string };
  update: (id: string, settings: PresetSettings) => void;
  remove: (id: string) => void;
};

export const usePresets = create<PresetStore>((set, get) => {
  const commit = (presets: Preset[]) => {
    set({ presets });
    store(presets);
  };

  return {
    presets: typeof localStorage === 'undefined' ? [] : load(),
    draft: null,

    openSave: (nodes, edges) => {
      const ids = nodes.filter((node) => node.selected).map((node) => node.id);
      const captured = capturePreset(nodes, edges, ids);
      if ('reason' in captured) return captured.reason;
      set({ draft: { kind: 'new', ids } });
      return null;
    },

    openEdit: (id) => set({ draft: { kind: 'edit', presetId: id } }),

    closeDraft: () => set({ draft: null }),

    save: (nodes, edges, ids, settings) => {
      const captured = capturePreset(nodes, edges, ids);
      if ('reason' in captured) return captured;
      const presets = get().presets;
      const preset: Preset = {
        id: `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: freeName(presets, settings?.name.trim() || captured.name),
        graph: captured.graph,
        exposed: settings?.exposed ?? captured.exposed,
      };
      commit([...presets, preset]);
      return { id: preset.id };
    },

    update: (id, settings) => {
      const presets = get().presets;
      const others = presets.filter((preset) => preset.id !== id);
      commit(
        presets.map((preset) =>
          preset.id === id
            ? {
                ...preset,
                name: settings.name.trim() === preset.name ? preset.name : freeName(others, settings.name.trim() || preset.name),
                exposed: settings.exposed,
              }
            : preset,
        ),
      );
    },

    remove: (id) => {
      commit(get().presets.filter((preset) => preset.id !== id));
      const draft = get().draft;
      if (draft?.kind === 'edit' && draft.presetId === id) set({ draft: null });
    },
  };
});
