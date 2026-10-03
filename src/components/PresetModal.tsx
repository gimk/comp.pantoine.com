import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkPlus, Plus, Search, X } from 'lucide-react';
import type { Edge } from '@xyflow/react';
import type { AppNode, ExposedParam } from '../state/graph';
import { deserializeGraph } from '../state/document';
import { moduleLabel, paramSpecsOf, pictureInputsOf } from '../state/groups';
import { capturePreset, usePresets, type PresetDraft, type PresetSettings } from '../state/presets';
import { useGraph } from '../state/store';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const paramId = (param: ExposedParam): string => [param.node, param.key, param.input ? 'input' : 'param'].join('\u0000');

/** What the dialog starts from: the preset's modules and wires, and its settings. */
type Source = PresetSettings & { members: AppNode[]; edges: Edge[]; groupId?: string };

/** Something a module could put on the group's card: a setting, or a picture input. */
type Entry = { param: ExposedParam; label: string };

/** A module in the preset, with what it could put on the card. */
type Module = { node: AppNode; label: string; entries: Entry[] };

/**
 * Read once, when the dialog opens: a new preset from the selection as it
 * is now, an existing one from what it saved. Modules come top to bottom,
 * as a group lists them.
 */
const readSource = (draft: PresetDraft): Source | null => {
  let source: Source | null = null;
  if (draft.kind === 'new') {
    const { nodes, edges } = useGraph.getState();
    const captured = capturePreset(nodes, edges, draft.ids);
    const graph = 'reason' in captured ? null : deserializeGraph(captured.graph);
    if (graph && !('reason' in captured)) source = { ...captured, members: graph.nodes, edges: graph.edges };
  } else {
    const preset = usePresets.getState().presets.find((candidate) => candidate.id === draft.presetId);
    const graph = preset && deserializeGraph(preset.graph);
    if (preset && graph) source = { name: preset.name, exposed: preset.exposed, members: graph.nodes, edges: graph.edges };
  }
  source?.members.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  return source;
};

/**
 * What each module could put on the card. Its picture inputs come first,
 * but only free ones: an input another module in the preset already feeds
 * has nothing left to plug in. Then its settings, all of them -- one driven
 * from inside still shows, locked, so the card can say what moves it.
 */
const modulesOf = (source: Source): Module[] =>
  source.members.map((node) => {
    const fed = (handle: string) => source.edges.some((edge) => edge.target === node.id && edge.targetHandle === handle);
    const inputs = pictureInputsOf(node)
      .filter((input) => !fed(input.key))
      .map((input): Entry => ({ param: { node: node.id, key: input.key, input: true }, label: input.label }));
    const params = paramSpecsOf(node).map((spec): Entry => ({ param: { node: node.id, key: spec.key }, label: spec.label }));
    return { node, label: moduleLabel(node), entries: [...inputs, ...params] };
  });

/**
 * Choosing what to add: everything not on the card yet, under its module's
 * name, narrowed by a search. Several can be ticked before adding.
 */
const ControlPicker: React.FC<{
  modules: Module[];
  taken: Set<string>;
  onAdd: (params: ExposedParam[]) => void;
  onCancel: () => void;
}> = ({ modules, taken, onAdd, onCancel }) => {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ExposedParam[]>([]);
  const pickedIds = new Set(picked.map(paramId));

  const needle = query.trim().toLowerCase();
  const shown = modules
    .map((module) => ({
      ...module,
      entries: module.entries.filter((entry) => {
        if (taken.has(paramId(entry.param))) return false;
        if (!needle) return true;
        return entry.label.toLowerCase().includes(needle) || module.label.toLowerCase().includes(needle);
      }),
    }))
    .filter((module) => module.entries.length > 0);

  const toggle = (param: ExposedParam) =>
    setPicked((current) =>
      pickedIds.has(paramId(param)) ? current.filter((other) => paramId(other) !== paramId(param)) : [...current, param],
    );

  return (
    <div className="control-picker">
      <div className="control-picker-search">
        <Search size={13} />
        <input
          value={query}
          autoFocus
          placeholder="Search settings and inputs"
          aria-label="Search settings and inputs"
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            // Enter adds what is ticked, rather than saving the whole preset.
            if (event.key === 'Enter') {
              event.preventDefault();
              if (picked.length > 0) onAdd(picked);
            }
          }}
        />
      </div>
      <div className="control-picker-list">
        {shown.length === 0 ? (
          <p className="control-picker-empty">{needle ? 'Nothing matches that search.' : 'Everything is already on the card.'}</p>
        ) : (
          shown.map((module) => (
            <div className="control-picker-module" key={module.node.id}>
              <span className="control-picker-heading">{module.label}</span>
              {module.entries.map((entry) => (
                <label className="control-picker-item" key={paramId(entry.param)}>
                  <input type="checkbox" checked={pickedIds.has(paramId(entry.param))} onChange={() => toggle(entry.param)} />
                  <span>{entry.label}</span>
                  {entry.param.input && <span className="tag">input</span>}
                </label>
              ))}
            </div>
          ))
        )}
      </div>
      <div className="control-picker-actions">
        <button type="button" className="preset-modal-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="preset-modal-button is-primary"
          disabled={picked.length === 0}
          onClick={() => onAdd(picked)}
        >
          {picked.length > 1 ? `Add ${picked.length}` : 'Add'}
        </button>
      </div>
    </div>
  );
};

const PresetDialog: React.FC<{ draft: PresetDraft }> = ({ draft }) => {
  const closeDraft = usePresets((state) => state.closeDraft);
  const [source] = useState(() => readSource(draft));
  const [name, setName] = useState(source?.name ?? '');
  const [exposed, setExposed] = useState<ExposedParam[]>(() => source?.exposed ?? []);
  const [picking, setPicking] = useState(false);
  const dialogRef = useRef<HTMLFormElement>(null);

  const modules = useMemo<Module[]>(() => (source ? modulesOf(source) : []), [source]);
  const describe = (param: ExposedParam) => {
    const module = modules.find((candidate) => candidate.node.id === param.node);
    const entry = module?.entries.find((candidate) => paramId(candidate.param) === paramId(param));
    return { module: module?.label ?? '', param: entry?.label ?? param.key };
  };
  const anyEntries = modules.some((module) => module.entries.length > 0);

  const submit = () => {
    if (!source) return;
    // A name of only spaces is no name: the module's own stands.
    const tidy = exposed.map(({ label, ...param }) => (label?.trim() ? { ...param, label: label.trim() } : param));
    const settings = { name, exposed: tidy };
    const presets = usePresets.getState();
    if (draft.kind === 'edit') {
      presets.update(draft.presetId, settings);
    } else {
      const { nodes, edges, renameGroup, setGroupExposed } = useGraph.getState();
      presets.save(nodes, edges, draft.ids, settings);
      // Saved from a group: the group itself takes on what was chosen, so
      // the card on the canvas is the preset as it will come back.
      if (source.groupId) {
        if (name.trim()) renameGroup(source.groupId, name.trim());
        setGroupExposed(source.groupId, tidy);
      }
    }
    closeDraft();
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const pickingRef = useRef(picking);
  pickingRef.current = picking;

  useEffect(() => {
    const dialog = dialogRef.current;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Capture phase on the window, ahead of the canvas's own listener, as
    // in the About dialog: Escape steps back (out of the picker, then out of
    // the dialog), Tab stays inside, and Ctrl+S -- which opened this --
    // saves it, rather than offering to save the page.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (pickingRef.current) setPicking(false);
        else closeDraft();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        event.stopPropagation();
        submitRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      returnTo?.focus();
    };
  }, [closeDraft]);

  // The preset was deleted, or the selection changed under a stale draft.
  useEffect(() => {
    if (!source) closeDraft();
  }, [source, closeDraft]);
  if (!source) return null;

  const title = draft.kind === 'edit' ? 'Edit preset' : 'Save as preset';

  return (
    <div className="modal-backdrop" onClick={closeDraft}>
      <form
        ref={dialogRef}
        className="about-modal preset-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preset-dialog-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="about-modal-header">
          <h2 id="preset-dialog-title" className="about-title preset-modal-title">
            <BookmarkPlus size={16} />
            {title}
          </h2>
          <button type="button" className="about-modal-close" onClick={closeDraft} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="about-modal-body">
          <label className="preset-field">
            <span className="about-section-title">Name</span>
            <input
              className="preset-modal-name"
              value={name}
              autoFocus
              placeholder="Preset"
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>

          <section className="preset-params" aria-labelledby="preset-params-title">
            <h3 id="preset-params-title" className="about-section-title">
              On the group's card
            </h3>
            <p className="about-desc">
              Pick the few settings and inputs worth reaching for. Settings show as sliders on the card, inputs as
              sockets to plug into; everything else stays tucked inside. Type over a name to rename it on the card.
            </p>

            {exposed.length > 0 && (
              <ul className="preset-controls">
                {exposed.map((param) => {
                  const label = describe(param);
                  return (
                    <li className="preset-control" key={paramId(param)}>
                      <span className="preset-control-module">{label.module}</span>
                      {/* The name on the card. Left empty, it keeps the module's own. */}
                      <input
                        className="preset-control-name"
                        value={param.label ?? ''}
                        placeholder={label.param}
                        aria-label={`Name on the card for ${label.module} ${label.param}`}
                        title="Rename it on the group's card"
                        onChange={(event) => {
                          const text = event.currentTarget.value;
                          setExposed((current) =>
                            current.map((other) => {
                              if (paramId(other) !== paramId(param)) return other;
                              const { label: _old, ...rest } = other;
                              return text ? { ...rest, label: text } : rest;
                            }),
                          );
                        }}
                      />
                      {param.input && <span className="tag">input</span>}
                      <button
                        type="button"
                        className="preset-action"
                        title="Remove from the card"
                        aria-label={`Remove ${label.module} ${label.param}`}
                        onClick={() => setExposed((current) => current.filter((other) => paramId(other) !== paramId(param)))}
                      >
                        <X size={12} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {picking ? (
              <ControlPicker
                modules={modules}
                taken={new Set(exposed.map(paramId))}
                onAdd={(params) => {
                  setExposed((current) => [...current, ...params]);
                  setPicking(false);
                }}
                onCancel={() => setPicking(false)}
              />
            ) : anyEntries ? (
              <button type="button" className="preset-add-control" onClick={() => setPicking(true)}>
                <Plus size={13} />
                {exposed.length === 0 ? 'Add to the card' : 'Add more'}
              </button>
            ) : (
              <p className="about-desc">None of these modules has a setting or a free input to show.</p>
            )}
          </section>
        </div>

        <div className="preset-modal-footer">
          <span className="preset-modal-count">
            {exposed.length === 0
              ? 'Nothing on the card yet'
              : `${exposed.length} on the card`}
          </span>
          <button type="button" className="preset-modal-button" onClick={closeDraft}>
            Cancel
          </button>
          <button type="submit" className="preset-modal-button is-primary">
            {draft.kind === 'edit' ? 'Save changes' : 'Save preset'}
          </button>
        </div>
      </form>
    </div>
  );
};

/**
 * The preset dialog: naming a preset and choosing what its group shows.
 * Opened from the toolbar's Save, from Ctrl+S, and from Edit on a saved
 * preset in the Presets menu.
 */
export const PresetModal: React.FC = () => {
  const draft = usePresets((state) => state.draft);
  if (!draft) return null;
  // Keyed, so opening it on something else starts afresh.
  return <PresetDialog key={draft.kind === 'edit' ? draft.presetId : draft.ids.join(',')} draft={draft} />;
};
