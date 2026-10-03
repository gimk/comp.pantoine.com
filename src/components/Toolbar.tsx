import React, { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Bookmark, BookmarkPlus, Group, Import, MonitorPlay, Pencil, Plus, Trash2 } from 'lucide-react';
import { useGraph } from '../state/store';
import { planGroup } from '../state/groups';
import { capturePreset, usePresets, type Preset } from '../state/presets';
import { BUILTIN_PRESETS } from '../state/builtinPresets';
import { PALETTE_DRAG_MIME, encodePaletteItem, paletteCenterOffset, type PaletteItem as PaletteItemPayload } from './paletteDrag';
import { addPaletteItem, catalog, type CatalogEntry, type CatalogFolder } from './paletteCatalog';

type MenuId = CatalogFolder['id'] | 'presets';

const ICONS: Record<MenuId, React.ReactNode> = {
  input: <Import size={14} />,
  module: <Plus size={14} />,
  output: <MonitorPlay size={14} />,
  presets: <Bookmark size={14} />,
};

const startDrag = (event: React.DragEvent, payload: PaletteItemPayload) => {
  event.dataTransfer.setData(PALETTE_DRAG_MIME, encodePaletteItem(payload));
  event.dataTransfer.effectAllowed = 'copy';
};

/**
 * One entry in a palette menu.
 *
 * Drag to place it where you want it; clicking drops one in the centre of
 * the active screen.
 */
const PaletteItem: React.FC<{
  entry: CatalogEntry;
  onSelect: (entry: CatalogEntry) => void;
  onDone: () => void;
}> = ({ entry, onSelect, onDone }) => (
  <button
    type="button"
    className="toolbar-menu-item"
    draggable
    onDragStart={(event) => startDrag(event, entry.payload)}
    // Left open during the drag: removing the element being dragged
    // mid-gesture cancels it in some browsers.
    onDragEnd={onDone}
    onClick={() => onSelect(entry)}
  >
    <span>{entry.label}</span>
    {entry.tag && <span className="tag">{entry.tag}</span>}
  </button>
);

/**
 * Group the selected modules. Shown once more than one thing is selected,
 * and greyed out, saying why, while the selection cannot be grouped -- so
 * the rule is learnt from the button rather than from nothing happening.
 */
const GroupButton: React.FC = () => {
  const groupSelection = useGraph((state) => state.groupSelection);
  // '' when the selection can be grouped, null when there is nothing to show.
  const reason = useGraph((state) => {
    const ids = state.nodes.filter((node) => node.selected).map((node) => node.id);
    if (ids.length < 2) return null;
    const result = planGroup(state.nodes, state.edges, ids);
    return 'reason' in result ? result.reason : '';
  });
  if (reason === null) return null;
  return (
    <>
      <button
        type="button"
        className="toolbar-button"
        disabled={reason !== ''}
        title={reason || 'Group the selected modules into one box (Ctrl+G)'}
        onClick={() => groupSelection()}
      >
        <Group size={14} />
        <span>Group</span>
      </button>
    </>
  );
};

/**
 * Save the selection as a preset, beside Group and shown on the same
 * terms -- plus for a single group, which is a preset's natural source.
 */
const SavePresetButton: React.FC = () => {
  const reason = useGraph((state) => {
    const selected = state.nodes.filter((node) => node.selected);
    if (selected.length === 0 || (selected.length === 1 && selected[0].type !== 'moduleGroup')) return null;
    const result = capturePreset(state.nodes, state.edges, selected.map((node) => node.id));
    return 'reason' in result ? result.reason : '';
  });
  if (reason === null) return null;
  return (
    <button
      type="button"
      className="toolbar-button"
      disabled={reason !== ''}
      title={reason || 'Save the selection as a preset (Ctrl+S)'}
      onClick={() => {
        const { nodes, edges } = useGraph.getState();
        usePresets.getState().openSave(nodes, edges);
      }}
    >
      <BookmarkPlus size={14} />
      <span>Save</span>
    </button>
  );
};

/** What can be done with the selection, set off from the menus by a rule. */
const SelectionActions: React.FC = () => {
  const shown = useGraph((state) => {
    const selected = state.nodes.filter((node) => node.selected);
    return selected.length > 1 || (selected.length === 1 && selected[0].type === 'moduleGroup');
  });
  if (!shown) return null;
  return (
    <>
      <span className="toolbar-sep" />
      <GroupButton />
      <SavePresetButton />
    </>
  );
};

/**
 * A saved preset in the Presets menu. Dragged or clicked like any other
 * entry, and it lands as a group. Edit opens the preset dialog on it, and
 * the bin asks once more before a preset is gone for good.
 */
const PresetEntry: React.FC<{
  preset: Preset;
  onSelect: (preset: Preset) => void;
  /** Absent for a built-in, which cannot be edited or deleted. */
  onEdit?: (preset: Preset) => void;
  onDone: () => void;
}> = ({ preset, onSelect, onEdit, onDone }) => {
  const remove = usePresets((state) => state.remove);
  const [confirming, setConfirming] = useState(false);
  const shown = preset.exposed.length;

  return (
    <div
      role="button"
      tabIndex={0}
      className="toolbar-menu-item preset-entry"
      draggable
      onDragStart={(event) => startDrag(event, { kind: 'preset', presetId: preset.id })}
      onDragEnd={onDone}
      onClick={() => onSelect(preset)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSelect(preset);
      }}
      onPointerLeave={() => setConfirming(false)}
    >
      <span className="preset-name">{preset.name}</span>
      {shown > 0 && (
        <span className="tag" title={`${shown} parameter${shown === 1 ? '' : 's'} on the card`}>
          {shown}
        </span>
      )}
      {onEdit && (
        <span className="preset-actions">
          <button
            type="button"
            className="preset-action"
            title="Edit name and parameters"
            onClick={(event) => {
              event.stopPropagation();
              onEdit(preset);
            }}
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            className={'preset-action' + (confirming ? ' is-confirming' : '')}
            title={confirming ? 'Click again to delete' : 'Delete'}
            onClick={(event) => {
              event.stopPropagation();
              if (confirming) remove(preset.id);
              else setConfirming(true);
            }}
          >
            <Trash2 size={12} />
            {confirming && <span>Delete?</span>}
          </button>
        </span>
      )}
    </div>
  );
};

/**
 * Floating glass pill holding everything that can go on the canvas, one
 * menu per folder of the catalog (see paletteCatalog). Each menu is grouped
 * under headings, because a flat list of two dozen is not a menu anyone
 * reads. Shift+A on the canvas opens the same catalog under the pointer.
 */
export const Toolbar: React.FC = () => {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss on any click that lands outside the menu.
  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as globalThis.Node)) setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openMenu]);

  const { screenToFlowPosition } = useReactFlow();

  const presets = usePresets((state) => state.presets);

  const close = () => setOpenMenu(null);
  const toggle = (menu: MenuId) => setOpenMenu((open) => (open === menu ? null : menu));
  const folder = catalog.find((f) => f.id === openMenu);

  const place = (payload: PaletteItemPayload) => {
    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const offset = paletteCenterOffset(payload);
    addPaletteItem(payload, {
      x: Math.round(center.x - offset.x),
      y: Math.round(center.y - offset.y),
    });
    close();
  };
  const handleSelect = (entry: CatalogEntry) => place(entry.payload);
  const handlePreset = (preset: Preset) => place({ kind: 'preset', presetId: preset.id });
  const handleEdit = (preset: Preset) => {
    close();
    usePresets.getState().openEdit(preset.id);
  };

  return (
    <div
      className="toolbar"
      ref={rootRef}
      onKeyDown={(event) => {
        // Escape closes an open menu, and only that: stopped here, at the
        // React root, it never reaches the canvas's window listener, which
        // would otherwise also clear the selection.
        if (event.key === 'Escape' && openMenu) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="glass toolbar-pill">
        <span className="brand">COMP</span>
        <span className="toolbar-sep" />
        {[...catalog, { id: 'presets' as const, label: 'Presets' }].map((f) => (
          <button
            key={f.id}
            type="button"
            className={'toolbar-button' + (openMenu === f.id ? ' is-active' : '')}
            aria-haspopup="menu"
            aria-expanded={openMenu === f.id}
            onClick={() => toggle(f.id)}
          >
            {ICONS[f.id]}
            <span>{f.label}</span>
          </button>
        ))}
        <SelectionActions />
      </div>

      {openMenu === 'presets' && (
        <div className="glass toolbar-menu">
          <div className="toolbar-menu-group">
            <span className="toolbar-menu-heading">Built-in</span>
            {BUILTIN_PRESETS.map((preset) => (
              <PresetEntry key={preset.id} preset={preset} onSelect={handlePreset} onDone={close} />
            ))}
          </div>
          <div className="toolbar-menu-group">
            <span className="toolbar-menu-heading">Yours</span>
            {presets.length === 0 ? (
              <p className="toolbar-menu-empty">
                No presets yet. Select a group, or modules wired together, and press Save (Ctrl+S).
              </p>
            ) : (
              presets.map((preset) => (
                <PresetEntry key={preset.id} preset={preset} onSelect={handlePreset} onEdit={handleEdit} onDone={close} />
              ))
            )}
          </div>
        </div>
      )}

      {folder && (
        <div className="glass toolbar-menu">
          {folder.groups.map((group, i) =>
            group.heading ? (
              <div className="toolbar-menu-group" key={group.heading}>
                <span className="toolbar-menu-heading">{group.heading}</span>
                {group.entries.map((entry) => (
                  <PaletteItem key={entry.key} entry={entry} onSelect={handleSelect} onDone={close} />
                ))}
              </div>
            ) : (
              <React.Fragment key={i}>
                {group.entries.map((entry) => (
                  <PaletteItem key={entry.key} entry={entry} onSelect={handleSelect} onDone={close} />
                ))}
              </React.Fragment>
            ),
          )}
        </div>
      )}
    </div>
  );
};
