/*
 * The keyboard shortcuts, as shown in the Shortcuts & info dialog. Keys only: pointer
 * gestures (drag to pan, double-click to reset...) are left for the UI to
 * show for itself.
 *
 * Kept by hand: the bindings live where they act (useCanvasShortcuts for
 * the canvas keyboard, controlPrimitives for scrubbing). A binding added
 * there belongs here too.
 */

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Ctrl on Windows and Linux, Cmd on a Mac: the chords take either. */
const MOD = isMac ? '⌘' : 'Ctrl';
const ALT = isMac ? '⌥' : 'Alt';

export interface Shortcut {
  label: string;
  /** Alternatives, each a set of keys pressed together. */
  keys: string[][];
  /** A few words of context, under the label. */
  note?: string;
}

export interface ShortcutSection {
  title: string;
  items: Shortcut[];
}

/*
 * Laid out in two columns by hand rather than left to CSS columns: those
 * cannot split a group, so one long group drags everything after it into
 * the second column. Keep the two about the same height.
 */
export const SHORTCUT_COLUMNS: ShortcutSection[][] = [
  [
    {
      title: 'Playback',
      items: [
        { label: 'Play / pause', keys: [['Space']] },
        { label: 'Back to the start', keys: [['R'], ['Home']] },
      ],
    },
    {
      title: 'Canvas',
      items: [
        { label: 'Add menu', note: 'Opens under the pointer; while dragging a wire, plugs the pick into it', keys: [['Shift', 'A'], ['Shift', 'I'], [MOD, '/']] },
        { label: 'Zoom to fit', note: 'The selection, or the whole graph', keys: [['F']] },
      ],
    },
    {
      title: 'Selection',
      items: [
        { label: 'Select all', keys: [[MOD, 'A']] },
        { label: 'Clear selection', keys: [['Esc']] },
      ],
    },
    {
      title: 'Groups & presets',
      items: [
        { label: 'Group', keys: [[MOD, 'G']] },
        { label: 'Ungroup', keys: [[MOD, 'Shift', 'G']] },
        { label: 'Save as preset', note: 'The selection, or a group', keys: [[MOD, 'S']] },
      ],
    },
  ],
  [
    {
      title: 'Editing',
      items: [
        { label: 'Undo', keys: [[MOD, 'Z']] },
        { label: 'Redo', keys: [[MOD, 'Shift', 'Z'], [MOD, 'Y']] },
        { label: 'Duplicate', keys: [[MOD, 'D']] },
        { label: 'Copy / cut', keys: [[MOD, 'C'], [MOD, 'X']] },
        { label: 'Paste', note: 'Lands under the pointer; a copied image or video becomes its module', keys: [[MOD, 'V']] },
        { label: 'Delete', note: 'The chain closes up behind it', keys: [['Delete'], ['Backspace']] },
      ],
    },
    {
      title: 'While dragging a module',
      items: [
        { label: 'Snap to neighbours', keys: [['Shift']] },
        { label: 'Lift out of its chain', keys: [['Ctrl']] },
        { label: 'Leave a copy behind', keys: [[ALT]] },
      ],
    },
    {
      title: 'While scrubbing a value',
      items: [
        { label: 'Faster', keys: [['Shift']] },
        { label: 'Finer', keys: [[ALT]] },
      ],
    },
  ],
];
