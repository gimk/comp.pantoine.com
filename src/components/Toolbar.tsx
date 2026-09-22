import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Import, MonitorPlay, Plus } from 'lucide-react';
import { registry } from '../engine/registry';
import { CATEGORY_LABELS, CATEGORY_ORDER, type Category, type EffectDef } from '../engine/effects';
import {
  PALETTE_DRAG_MIME,
  encodePaletteItem,
  type PaletteItem as PaletteItemPayload,
} from './paletteDrag';
import { useGraph } from '../state/store';

type MenuId = 'input' | 'module' | 'output';

/**
 * One entry in a palette menu.
 *
 * Drag to place it where you want it; clicking still drops one on the
 * canvas, which is the fallback for touch and for the keyboard, where there
 * is no drag at all.
 */
const PaletteItem: React.FC<{
  label: string;
  payload: PaletteItemPayload;
  tag?: string;
  onPick: () => void;
  onDone: () => void;
}> = ({ label, payload, tag, onPick, onDone }) => (
  <button
    className="toolbar-menu-item"
    draggable
    onDragStart={(event) => {
      event.dataTransfer.setData(PALETTE_DRAG_MIME, encodePaletteItem(payload));
      event.dataTransfer.effectAllowed = 'copy';
    }}
    // Left open during the drag: removing the element being dragged
    // mid-gesture cancels it in some browsers.
    onDragEnd={onDone}
    onClick={() => {
      onPick();
      onDone();
    }}
  >
    <span>{label}</span>
    {tag && <span className="tag">{tag}</span>}
  </button>
);

/**
 * Floating glass pill holding everything that can go on the canvas.
 *
 * Split the way the graph is: what comes in, what happens in the middle,
 * what comes out. The module menu is built from the effect registry, so a
 * new effect shows up the moment it is registered, and it is grouped by
 * category because a flat list of two dozen is not a menu anyone reads.
 */
export const Toolbar: React.FC = () => {
  const addImageNode = useGraph((state) => state.addImageNode);
  const addEffectNode = useGraph((state) => state.addEffectNode);
  const addOutputNode = useGraph((state) => state.addOutputNode);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Empty categories are dropped, so the menu never shows a heading with
  // nothing under it while the module set is still filling out.
  const groups = useMemo(() => {
    const byCategory = new Map<Category, EffectDef[]>();
    for (const def of registry) {
      const existing = byCategory.get(def.category);
      if (existing) existing.push(def);
      else byCategory.set(def.category, [def]);
    }
    return CATEGORY_ORDER.flatMap((category) => {
      const defs = byCategory.get(category);
      return defs ? [{ category, defs }] : [];
    });
  }, []);

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

  const button = (menu: MenuId, icon: React.ReactNode, label: string) => (
    <button
      className={'toolbar-button' + (openMenu === menu ? ' is-active' : '')}
      onClick={() => toggle(menu)}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="toolbar" ref={rootRef}>
      <div className="glass toolbar-pill">
        <span className="brand">COMP</span>
        <span className="toolbar-sep" />
        {button('input', <Import size={14} />, 'Input')}
        {button('module', <Plus size={14} />, 'Module')}
        {button('output', <MonitorPlay size={14} />, 'Output')}
      </div>

      {openMenu === 'input' && (
        <div className="glass toolbar-menu">
          <PaletteItem
            label="Image"
            payload={{ kind: 'image' }}
            onPick={() => addImageNode()}
            onDone={close}
          />
        </div>
      )}

      {openMenu === 'output' && (
        <div className="glass toolbar-menu">
          <PaletteItem
            label="Viewer"
            payload={{ kind: 'output' }}
            onPick={() => addOutputNode()}
            onDone={close}
          />
        </div>
      )}

      {openMenu === 'module' && (
        <div className="glass toolbar-menu">
          {groups.map(({ category, defs }) => (
            <div className="toolbar-menu-group" key={category}>
              <span className="toolbar-menu-heading">{CATEGORY_LABELS[category]}</span>
              {defs.map((def) => (
                <PaletteItem
                  key={def.id}
                  label={def.label}
                  payload={{ kind: 'effect', effectId: def.id }}
                  /* A function means "animated at some settings" -- the tag
                     marks what can move, not what happens to be moving. */
                  tag={def.animated !== false ? 'animated' : undefined}
                  onPick={() => addEffectNode(def.id)}
                  onDone={close}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
