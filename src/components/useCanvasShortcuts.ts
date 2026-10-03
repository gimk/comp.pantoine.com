import { useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { redo, undo } from '../state/history';
import { isDragging, setDragModifiers, setSnapping, useGraph } from '../state/store';
import { usePresets } from '../state/presets';
import { resetClock, togglePlaying } from '../engine/clock';
import { addMediaFiles } from './paletteCatalog';

/** Put on the system clipboard in place of copied modules; see onCopy. */
const MODULES_MIME = 'application/x-comp-modules';

/** How far a Ctrl+D copy lands from its original, in graph units. */
const DUPLICATE_OFFSET = { x: 32, y: 32 };

/*
 * Only fields that take typed text swallow shortcuts. A slider keeps focus
 * after it is dragged, and Ctrl+D straight after nudging one should still
 * duplicate the node rather than do nothing.
 */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'number', 'email', 'url', 'password', 'tel']);

const isTypingInto = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA') return true;
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
};

/*
 * A focused <select> reads plain letters as type-ahead (R jumps to "Red",
 * F to "Full"), so unmodified letter keys there are its own. Space is the
 * exception: it always plays/pauses, from any control (see below).
 */
const isSelect = (target: EventTarget | null): boolean => target instanceof HTMLSelectElement;

/*
 * Clipboard chords mean nothing on a slider or a menu, but the user's
 * attention is on the control, not the selection behind it: a stray Ctrl+X
 * while fiddling with a value shouldn't delete the module it lives on.
 */
const isValueControl = (target: EventTarget | null): boolean =>
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLInputElement && target.type === 'range');

/*
 * While a modal dialog is open the graph behind it is inert: Escape, Space
 * and the rest belong to the dialog (or to nothing), never to a selection
 * the user can't see.
 */
const dialogIsOpen = (): boolean => document.querySelector('[aria-modal="true"]') !== null;


/**
 * The canvas keyboard, bound to the window.
 *
 *   Ctrl/Cmd + Z         undo
 *   Ctrl/Cmd + Shift + Z redo (Ctrl + Y too)
 *   Ctrl/Cmd + D         duplicate the selection
 *   Ctrl/Cmd + C / X / V copy, cut, paste (paste lands under the pointer;
 *                        an image or video on the system clipboard pastes
 *                        as its module)
 *   Ctrl/Cmd + G         group the selection; with Shift, ungroup it
 *   Ctrl/Cmd + S         save the selection (or a group) as a preset
 *   Ctrl/Cmd + A         select everything
 *   Escape               clear the selection
 *   F                    frame the selection, or the whole graph
 *   Space                play / pause
 *   R (or Home)          back to time 0
 *   Shift + A / Shift + I / Cmd + / the add menu, under the pointer; while
 *                        dragging a wire, what is picked is plugged into it
 *   Shift (while dragging) snap to other modules' centres
 *   Ctrl (while dragging)  lift the module out of its chain
 *   Alt (while dragging)   leave a copy behind
 *
 * The three drag modifiers can be pressed or let go at any point in a drag.
 * Shift-click selection is a pointer gesture and lives on the ReactFlow
 * props instead.
 *
 * The Shortcuts & info dialog lists all of these from shortcutList.ts; a change here
 * belongs there too.
 */
export const useCanvasShortcuts = (
  fitPadding: number,
  onQuickAdd: (at: { x: number; y: number }) => void,
): void => {
  const { fitView, screenToFlowPosition } = useReactFlow();
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // Read through a ref, so a new callback each render does not rebind the
  // window listeners.
  const quickAdd = useRef(onQuickAdd);
  quickAdd.current = onQuickAdd;

  useEffect(() => {
    const pointerInFlow = () => (pointer.current ? screenToFlowPosition(pointer.current) : undefined);

    /*
     * Modules copied here live in the app's own clipboard, but an image
     * copied earlier elsewhere would still sit in the system one and win
     * the next paste. So a copy that took modules also overwrites the system
     * clipboard with a marker, from the copy event that follows the keys.
     */
    let claimCopy = false;
    const onCopy = (event: ClipboardEvent) => {
      if (!claimCopy) return;
      claimCopy = false;
      event.clipboardData?.setData(MODULES_MIME, '1');
      event.preventDefault();
    };

    /*
     * Ctrl+V: an image or video on the system clipboard -- a screenshot, a
     * picture copied from a page -- becomes its module under the pointer.
     * Anything else pastes the app's own clipboard.
     */
    let pendingPaste = 0;
    const onPaste = (event: ClipboardEvent) => {
      if (isTypingInto(event.target) || isValueControl(event.target) || dialogIsOpen() || isDragging()) return;
      window.clearTimeout(pendingPaste);
      event.preventDefault();
      const at = pointerInFlow();
      const files = event.clipboardData?.files;
      if (files && addMediaFiles(files, at) > 0) return;
      useGraph.getState().paste(at);
    };

    // Shift snaps, Ctrl lifts out of the chain, Alt duplicates: all three
    // follow the keys for the whole of a drag, not just how it started.
    const trackModifiers = (event: KeyboardEvent | PointerEvent) => {
      setSnapping(event.shiftKey);
      setDragModifiers({ ctrl: event.ctrlKey, alt: event.altKey });
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      // Also caught here, so a key pressed before the window had focus
      // still counts once the pointer moves.
      trackModifiers(event);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      trackModifiers(event);
      if (isDragging()) {
        // Alt on its own, pressed and let go, would otherwise send focus to
        // the browser's menu bar on Windows. And nothing else is a shortcut
        // while a drag is under way.
        if (event.key === 'Alt') event.preventDefault();
        return;
      }
      if (isTypingInto(event.target) || dialogIsOpen()) return;

      const store = useGraph.getState();
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (!mod && !event.altKey && event.code !== 'Space' && isSelect(event.target)) return;

      if (mod && key === 'z') {
        // Otherwise a focused slider or the page itself may act on it too.
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && key === 'y') {
        event.preventDefault();
        redo();
      } else if (mod && key === 'd') {
        // Otherwise the browser offers to bookmark the page.
        event.preventDefault();
        store.duplicateSelection(DUPLICATE_OFFSET);
      } else if (mod && key === 'c') {
        claimCopy = false;
        // Leave a text selection to the browser's own copy.
        if (window.getSelection()?.toString() || isValueControl(event.target)) return;
        claimCopy = store.copySelection();
      } else if (mod && key === 'x') {
        claimCopy = false;
        if (isValueControl(event.target)) return;
        claimCopy = store.cutSelection();
      } else if (mod && key === 'v') {
        if (isValueControl(event.target)) return;
        // Not prevented: that would cancel the paste event, the only place
        // the system clipboard can be read. onPaste takes it from here, and
        // the timer stands in for a browser that sends none.
        const at = pointerInFlow();
        window.clearTimeout(pendingPaste);
        pendingPaste = window.setTimeout(() => useGraph.getState().paste(at), 0);
      } else if (mod && !event.altKey && key === 'g') {
        // Otherwise the browser's find-next.
        event.preventDefault();
        if (event.shiftKey) {
          for (const node of store.nodes) if (node.selected && node.type === 'moduleGroup') store.ungroup(node.id);
        } else {
          store.groupSelection();
        }
      } else if (mod && !event.altKey && !event.shiftKey && key === 's') {
        // Otherwise the browser offers to save the page, which is never
        // what Ctrl+S on the canvas means here, saveable selection or not.
        event.preventDefault();
        usePresets.getState().openSave(store.nodes, store.edges);
      } else if (mod && key === 'a') {
        event.preventDefault();
        store.setAllSelected(true);
      } else if (!mod && !event.altKey && key === 'escape') {
        store.setAllSelected(false);
      } else if (!mod && !event.altKey && event.code === 'Space') {
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
          if (!isTypingInto(document.activeElement)) {
            document.activeElement.blur();
          }
        }
        if (!event.repeat) togglePlaying();
      } else if (!mod && !event.altKey && (key === 'home' || (key === 'r' && !event.shiftKey))) {
        event.preventDefault();
        resetClock();
      } else if (
        (!mod && !event.altKey && event.shiftKey && (key === 'a' || key === 'i')) ||
        (mod && !event.altKey && (key === '/' || event.code === 'Slash'))
      ) {
        event.preventDefault();
        // A pointer that has not moved since the page loaded has no known
        // position; the middle of the window is the next best guess.
        quickAdd.current(pointer.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      } else if (!mod && !event.altKey && key === 'f') {
        const selected = store.nodes.filter((node) => node.selected);
        void fitView({
          nodes: selected.length > 0 ? selected.map((node) => ({ id: node.id })) : undefined,
          padding: fitPadding,
          duration: 220,
        });
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      trackModifiers(event);
      if (isDragging() && event.key === 'Alt') event.preventDefault();
    };
    // A key released while another window had focus never reports back.
    const onBlur = () => {
      setSnapping(false);
      setDragModifiers({ ctrl: false, alt: false });
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCopy);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCopy);
      window.removeEventListener('paste', onPaste);
      window.clearTimeout(pendingPaste);
    };
  }, [fitView, fitPadding, screenToFlowPosition]);
};
