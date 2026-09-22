import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, Plus } from 'lucide-react';
import { registry } from '../engine/registry';
import { CATEGORY_LABELS, CATEGORY_ORDER, type Category, type EffectDef } from '../engine/effects';
import { useGraph } from '../state/store';

/**
 * Floating glass pill holding the two things you can add to the graph.
 *
 * The module menu is built from the effect registry, so a new effect shows
 * up here the moment it is registered. It is grouped by category rather than
 * listed flat: the modules are atomic on purpose, so there will be a couple
 * of dozen of them, and a flat list of two dozen is not a menu anyone reads.
 */
export const Toolbar: React.FC = () => {
  const addImageNode = useGraph((state) => state.addImageNode);
  const addEffectNode = useGraph((state) => state.addEffectNode);
  const [isOpen, setIsOpen] = useState(false);
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
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as globalThis.Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  return (
    <div className="toolbar" ref={rootRef}>
      <div className="glass toolbar-pill">
        <span className="brand">COMP</span>
        <span className="toolbar-sep" />

        <button className="toolbar-button" onClick={addImageNode}>
          <ImagePlus size={14} />
          <span>Image</span>
        </button>

        <button
          className={'toolbar-button' + (isOpen ? ' is-active' : '')}
          onClick={() => setIsOpen((open) => !open)}
        >
          <Plus size={14} />
          <span>Module</span>
        </button>
      </div>

      {isOpen && (
        <div className="glass toolbar-menu">
          {groups.map(({ category, defs }) => (
            <div className="toolbar-menu-group" key={category}>
              <span className="toolbar-menu-heading">{CATEGORY_LABELS[category]}</span>
              {defs.map((def) => (
                <button
                  key={def.id}
                  className="toolbar-menu-item"
                  onClick={() => {
                    addEffectNode(def.id);
                    setIsOpen(false);
                  }}
                >
                  <span>{def.label}</span>
                  {/* A function means "animated at some settings" -- the tag
                      marks what can move, not what happens to be moving. */}
                  {def.animated !== false && <span className="tag">animated</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
