import React, { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Group, Import, MonitorPlay, Plus } from 'lucide-react';
import { useGraph } from '../state/store';
import { planGroup } from '../state/groups';
import { PALETTE_DRAG_MIME, encodePaletteItem, paletteCenterOffset } from './paletteDrag';
import { addPaletteItem, catalog, type CatalogEntry, type CatalogFolder } from './paletteCatalog';

type MenuId = CatalogFolder['id'];

const ICONS: Record<MenuId, React.ReactNode> = {
  input: <Import size={14} />,
  module: <Plus size={14} />,
  output: <MonitorPlay size={14} />,
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
    onDragStart={(event) => {
      event.dataTransfer.setData(PALETTE_DRAG_MIME, encodePaletteItem(entry.payload));
      event.dataTransfer.effectAllowed = 'copy';
    }}
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
      <span className="toolbar-sep" />
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

  const close = () => setOpenMenu(null);
  const toggle = (menu: MenuId) => setOpenMenu((open) => (open === menu ? null : menu));
  const folder = catalog.find((f) => f.id === openMenu);

  const handleSelect = (entry: CatalogEntry) => {
    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const offset = paletteCenterOffset(entry.payload);
    addPaletteItem(entry.payload, {
      x: Math.round(center.x - offset.x),
      y: Math.round(center.y - offset.y),
    });
    close();
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
        {catalog.map((f) => (
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
        <GroupButton />
      </div>

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
