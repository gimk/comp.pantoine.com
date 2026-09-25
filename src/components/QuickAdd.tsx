import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { ChevronRight } from 'lucide-react';
import { paletteDropOffset } from './paletteDrag';
import { addPaletteItem, catalog, type CatalogEntry, type CatalogGroup } from './paletteCatalog';

/** How far up and left of the pointer the menu opens, so the pointer lands inside it. */
const ANCHOR_INSET = 14;

/** Room kept between the menu and the window's edges, as `--gutter`. */
const EDGE = 18;

type Found = CatalogEntry & { where: string };

/** Every entry, with where it lives, for searching. */
const everything: Found[] = catalog.flatMap((folder) =>
  folder.groups.flatMap((group) =>
    group.entries.map((entry) => ({ ...entry, where: group.heading ?? folder.label })),
  ),
);

type QuickAddCategory = {
  id: string;
  label: string;
  groups: CatalogGroup[];
};

const moduleFolder = catalog.find((f) => f.id === 'module');
const inputFolder = catalog.find((f) => f.id === 'input');
const outputFolder = catalog.find((f) => f.id === 'output');

/**
 * Top-level categories shown in Shift+A.
 *
 * Each module sub-category (Color & Tone, Stylize, Optics, CRT, etc.)
 * is presented directly alongside Input and Output so the user can jump straight
 * into the category without intermediate section headings.
 */
const quickAddCategories: QuickAddCategory[] = [
  {
    id: 'input',
    label: 'Input',
    groups: inputFolder?.groups ?? [],
  },
  ...(moduleFolder?.groups.map((group, index) => ({
    id: `module:${group.heading ?? index}`,
    label: group.heading ?? 'Module',
    groups: [{ entries: group.entries }],
  })) ?? []),
  {
    id: 'output',
    label: 'Output',
    groups: outputFolder?.groups ?? [],
  },
];

const itemsIn = (column: Element | null): HTMLElement[] =>
  column ? Array.from(column.querySelectorAll<HTMLElement>('[data-qa-item]')) : [];

/**
 * Blender's Shift+A: the whole catalog in a menu under the pointer, and
 * whatever is picked lands where the pointer was.
 *
 * Categories open to the side on hover, focus or the right arrow. Typing searches
 * every folder at once, and Enter takes the first match.
 * Escape, or a click or scroll anywhere else, closes it.
 */
export const QuickAdd: React.FC<{ at: { x: number; y: number }; onClose: () => void }> = ({ at, onClose }) => {
  const { screenToFlowPosition } = useReactFlow();
  const rootRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [place, setPlace] = useState({ left: at.x - ANCHOR_INSET, top: at.y - ANCHOR_INSET });

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return everything.filter(
      (entry) => entry.label.toLowerCase().includes(q) || entry.where.toLowerCase().includes(q),
    );
  }, [query]);

  const folder = results ? undefined : quickAddCategories.find((f) => f.id === openId);

  // Kept inside the window: opened near an edge, it moves in rather than
  // hanging off it.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const { width, height } = root.getBoundingClientRect();
    setPlace({
      left: Math.max(EDGE, Math.min(at.x - ANCHOR_INSET, window.innerWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(at.y - ANCHOR_INSET, window.innerHeight - height - EDGE)),
    });
  }, [at]);

  // The side menu opens level with its folder's row, to the right unless
  // there is no room there, and moves up if it would run off the bottom.
  useLayoutEffect(() => {
    const sub = subRef.current;
    const root = rootRef.current;
    if (!sub || !root || !openId) return;
    const row = root.querySelector<HTMLElement>(`[data-qa-folder="${openId}"]`);
    const rootBox = root.getBoundingClientRect();
    const rowTop = row ? row.getBoundingClientRect().top - rootBox.top - 6 : 0;
    const { width, height } = sub.getBoundingClientRect();
    const flip = rootBox.right + width + EDGE > window.innerWidth;
    sub.classList.toggle('is-flipped', flip);
    const maxTop = window.innerHeight - EDGE - height - rootBox.top;
    sub.style.top = `${Math.max(EDGE - rootBox.top, Math.min(rowTop, maxTop))}px`;
  }, [folder, openId, place]);

  useEffect(() => {
    searchRef.current?.focus();
    const outside = (event: Event) => {
      if (!rootRef.current?.contains(event.target as globalThis.Node)) onClose();
    };
    // Capture, so a click on a node or the canvas closes the menu before
    // anything else makes of it.
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('wheel', outside, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('wheel', outside, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const pick = (entry: CatalogEntry) => {
    const point = screenToFlowPosition(at);
    const offset = paletteDropOffset(entry.payload);
    addPaletteItem(entry.payload, { x: point.x - offset.x, y: point.y - offset.y });
    onClose();
  };

  const focusSub = () => {
    // After the side menu has rendered for a folder opened this same tick.
    requestAnimationFrame(() => itemsIn(subRef.current)[0]?.focus());
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Everything typed here is for the menu; none of it reaches the canvas
    // shortcuts, which listen on the window.
    event.stopPropagation();
    const active = document.activeElement as HTMLElement | null;
    const column = active?.closest('[data-qa-column]') ?? null;
    const items = itemsIn(column);
    const index = active ? items.indexOf(active) : -1;
    const inSearch = active === searchRef.current;

    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (inSearch) {
        if (event.key === 'ArrowDown') itemsIn(rootRef.current?.querySelector('[data-qa-main]') ?? null)[0]?.focus();
        return;
      }
      const next = index + (event.key === 'ArrowDown' ? 1 : -1);
      if (next < 0 && column?.hasAttribute('data-qa-main')) searchRef.current?.focus();
      else items[(next + items.length) % items.length]?.focus();
    } else if (event.key === 'ArrowRight' && active?.dataset.qaFolder) {
      event.preventDefault();
      setOpenId(active.dataset.qaFolder);
      focusSub();
    } else if (event.key === 'ArrowLeft' && column === subRef.current) {
      event.preventDefault();
      rootRef.current?.querySelector<HTMLElement>(`[data-qa-folder="${openId}"]`)?.focus();
    } else if (event.key === 'Enter' && inSearch && results?.[0]) {
      event.preventDefault();
      pick(results[0]);
    }
  };

  const entryButton = (entry: CatalogEntry, hint?: string) => (
    <button key={entry.key} type="button" className="quick-add-item" data-qa-item onClick={() => pick(entry)}>
      <span>{entry.label}</span>
      {hint && <span className="quick-add-hint">{hint}</span>}
      {entry.tag && <span className="tag">{entry.tag}</span>}
    </button>
  );

  return (
    <div
      className="quick-add"
      ref={rootRef}
      style={place}
      onKeyDown={onKeyDown}
      role="menu"
      aria-label="Add a module"
      // No browser menu over ours.
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="glass quick-add-panel" data-qa-column data-qa-main>
        <input
          ref={searchRef}
          className="quick-add-search"
          type="search"
          placeholder="Add…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          spellCheck={false}
          aria-label="Search modules"
        />
        {results ? (
          results.length > 0 ? (
            <div className="quick-add-list">{results.map((entry) => entryButton(entry, entry.where))}</div>
          ) : (
            <span className="quick-add-empty">Nothing matches</span>
          )
        ) : (
          <div className="quick-add-folders">
            {quickAddCategories.map((f) => (
              <button
                key={f.id}
                type="button"
                className={'quick-add-item quick-add-folder' + (openId === f.id ? ' is-open' : '')}
                data-qa-item
                data-qa-folder={f.id}
                aria-haspopup="menu"
                aria-expanded={openId === f.id}
                onPointerEnter={() => setOpenId(f.id)}
                onFocus={() => setOpenId(f.id)}
                onClick={() => {
                  setOpenId(f.id);
                  focusSub();
                }}
              >
                <span>{f.label}</span>
                <ChevronRight size={13} />
              </button>
            ))}
          </div>
        )}
      </div>

      {folder && (
        <div className="glass quick-add-panel quick-add-sub" ref={subRef} data-qa-column>
          {folder.groups.map((group, i) => (
            <div className="toolbar-menu-group" key={group.heading ?? i}>
              {group.heading && <span className="toolbar-menu-heading">{group.heading}</span>}
              {group.entries.map((entry) => entryButton(entry))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
