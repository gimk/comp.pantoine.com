import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Plus } from 'lucide-react';
import { registry } from '../engine/registry';
import { useGraph } from '../state/store';

/**
 * Floating glass pill holding the two things you can add to the graph.
 *
 * The module menu is built from the effect registry, so a new effect shows
 * up here the moment it is registered.
 */
export const Toolbar: React.FC = () => {
  const addImageNode = useGraph((state) => state.addImageNode);
  const addEffectNode = useGraph((state) => state.addEffectNode);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
          {registry.map((def) => (
            <button
              key={def.id}
              className="toolbar-menu-item"
              onClick={() => {
                addEffectNode(def.id);
                setIsOpen(false);
              }}
            >
              <span>{def.label}</span>
              {def.animated && <span className="tag">animated</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
