/**
 * The contract between the module menu and the canvas for a dragged module.
 *
 * A custom MIME type rather than `text/plain`: it means the canvas can tell
 * one of our modules from a file, a selection or a link dragged in from
 * elsewhere, and refuse the drop instead of creating a node from it.
 */
export const MODULE_DRAG_MIME = 'application/x-comp-module';

/**
 * Where the card sits relative to the pointer when it lands.
 *
 * Half the node's width across, so it drops centred rather than hanging off
 * to the right, and a little way down so the pointer is on the title bar --
 * as though the card had been carried by its header.
 *
 * The x mirrors `.node { width }` in the stylesheet; change one and change
 * the other. Height is not mirrored because it varies with the effect's
 * parameter count, and there is nothing to read it from before the node
 * exists.
 */
export const MODULE_DROP_OFFSET = { x: 98, y: 18 };
