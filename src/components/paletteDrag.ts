import { DEFAULT_PREVIEW_WIDTH } from '../state/graph';

/**
 * The contract between the toolbar palette and the canvas for a dragged item.
 *
 * A custom MIME type rather than `text/plain`: it means the canvas can tell
 * one of our items from a file, a selection or a link dragged in from
 * elsewhere, and refuse the drop instead of creating a node from it.
 */
export const PALETTE_DRAG_MIME = 'application/x-comp-palette';

/** Everything the palette can put on the canvas. */
export type PaletteItem =
  | { kind: 'effect'; effectId: string }
  | { kind: 'modulator'; modulatorId: string }
  | { kind: 'image' }
  | { kind: 'output' }
  | { kind: 'background' }
  | { kind: 'render' }
  | { kind: 'formatter' }
  | { kind: 'export' };

export const encodePaletteItem = (item: PaletteItem): string => JSON.stringify(item);

/**
 * Parse a dropped payload, or null if it is not one of ours.
 *
 * Checked rather than trusted: the MIME type keeps most foreign drags out,
 * but the value still arrives as a string from the platform and a malformed
 * one should be refused, not turned into a node of some undefined kind.
 */
export const decodePaletteItem = (raw: string): PaletteItem | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const item = parsed as PaletteItem;
    if (item.kind === 'effect') return typeof item.effectId === 'string' ? item : null;
    if (item.kind === 'modulator') return typeof item.modulatorId === 'string' ? item : null;
    if (
      item.kind === 'image' ||
      item.kind === 'output' ||
      item.kind === 'background' ||
      item.kind === 'render' ||
      item.kind === 'formatter' ||
      item.kind === 'export'
    ) {
      return item;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Where a dropped card sits relative to the pointer.
 *
 * Half its width across, so it lands centred rather than hanging off to the
 * right, and a little way down so the pointer is on the title bar -- as
 * though the card had been carried by its header.
 *
 * The 98 is half of `.node { width: 196px }` in the stylesheet; change one
 * and change the other. A viewer is wider than an ordinary node, so it gets
 * its own figure. Height is never mirrored: it varies with an effect's
 * parameter count and with the picture's shape, and there is nothing to read
 * it from before the node exists.
 */
export const paletteDropOffset = (item: PaletteItem): { x: number; y: number } => ({
  x:
    item.kind === 'output'
      ? DEFAULT_PREVIEW_WIDTH / 2
      : item.kind === 'formatter' || item.kind === 'export' || item.kind === 'background'
        ? 110
        : 98,
  y: 18,
});
