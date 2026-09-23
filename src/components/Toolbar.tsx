import React, { useEffect, useRef, useState } from 'react';
import { Import, MonitorPlay, Plus } from 'lucide-react';
import { PALETTE_DRAG_MIME, encodePaletteItem } from './paletteDrag';
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
 * Drag to place it where you want it; clicking still drops one on the
 * canvas, which is the fallback for touch and for the keyboard, where there
 * is no drag at all.
 */
const PaletteItem: React.FC<{ entry: CatalogEntry; onDone: () => void }> = ({ entry, onDone }) => (
  <button
    className="toolbar-menu-item"
    draggable
    onDragStart={(event) => {
      event.dataTransfer.setData(PALETTE_DRAG_MIME, encodePaletteItem(entry.payload));
      event.dataTransfer.effectAllowed = 'copy';
    }}
    // Left open during the drag: removing the element being dragged
    // mid-gesture cancels it in some browsers.
    onDragEnd={onDone}
    onClick={() => {
      addPaletteItem(entry.payload);
      onDone();
    }}
  >
    <span>{entry.label}</span>
    {entry.tag && <span className="tag">{entry.tag}</span>}
  </button>
);

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

  const close = () => setOpenMenu(null);
  const toggle = (menu: MenuId) => setOpenMenu((open) => (open === menu ? null : menu));
  const folder = catalog.find((f) => f.id === openMenu);

  return (
    <div className="toolbar" ref={rootRef}>
      <div className="glass toolbar-pill">
        <span className="brand">COMP</span>
        <span className="toolbar-sep" />
        {catalog.map((f) => (
          <button
            key={f.id}
            className={'toolbar-button' + (openMenu === f.id ? ' is-active' : '')}
            onClick={() => toggle(f.id)}
          >
            {ICONS[f.id]}
            <span>{f.label}</span>
          </button>
        ))}
      </div>

      {folder && (
        <div className="glass toolbar-menu">
          {folder.groups.map((group, i) =>
            group.heading ? (
              <div className="toolbar-menu-group" key={group.heading}>
                <span className="toolbar-menu-heading">{group.heading}</span>
                {group.entries.map((entry) => (
                  <PaletteItem key={entry.key} entry={entry} onDone={close} />
                ))}
              </div>
            ) : (
              <React.Fragment key={i}>
                {group.entries.map((entry) => (
                  <PaletteItem key={entry.key} entry={entry} onDone={close} />
                ))}
              </React.Fragment>
            ),
          )}
        </div>
      )}
    </div>
  );
};
