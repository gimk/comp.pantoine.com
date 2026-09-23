import { useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { redo, undo } from '../state/history';
import { isDragging, setDragModifiers, setSnapping, useGraph } from '../state/store';
import { resetClock, togglePlaying } from '../engine/clock';

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
 * Space means something to a focused button, switch or menu -- press it,
 * flip it, open it -- and that meaning wins. Except on the transport's own
 * buttons, where it would be the same action as the shortcut and the two
 * together would toggle twice.
 */
const spaceBelongsTo = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[data-transport]')) return false;
  return target.closest('button, select, a[href], [role="switch"]') !== null;
};

/**
 * The canvas keyboard, bound to the window.
 *
 *   Ctrl/Cmd + Z         undo
 *   Ctrl/Cmd + Shift + Z redo (Ctrl + Y too)
 *   Ctrl/Cmd + D         duplicate the selection
 *   Ctrl/Cmd + C / X / V copy, cut, paste (paste lands under the pointer)
 *   Ctrl/Cmd + A         select everything
 *   Escape               clear the selection
 *   F                    frame the selection, or the whole graph
 *   Space                play / pause
 *   R (or Home)          back to time 0
 *   Shift + A            the add menu, under the pointer
 *   Shift (while dragging) snap to other modules' centres
 *   Ctrl (while dragging)  lift the module out of its chain
 *   Alt (while dragging)   leave a copy behind
 *
 * The three drag modifiers can be pressed or let go at any point in a drag.
 * Shift-click selection is a pointer gesture and lives on the ReactFlow
 * props instead.
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
      if (isTypingInto(event.target)) return;

      const store = useGraph.getState();
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

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
        // Leave a text selection to the browser's own copy.
        if (window.getSelection()?.toString()) return;
        store.copySelection();
      } else if (mod && key === 'x') {
        store.cutSelection();
      } else if (mod && key === 'v') {
        event.preventDefault();
        store.paste(pointer.current ? screenToFlowPosition(pointer.current) : undefined);
      } else if (mod && key === 'a') {
        event.preventDefault();
        store.setAllSelected(true);
      } else if (!mod && !event.altKey && key === 'escape') {
        store.setAllSelected(false);
      } else if (!mod && !event.altKey && event.code === 'Space') {
        if (spaceBelongsTo(event.target)) return;
        // Or the page scrolls, or a focused transport button clicks too.
        event.preventDefault();
        if (!event.repeat) togglePlaying();
      } else if (!mod && !event.altKey && (key === 'home' || (key === 'r' && !event.shiftKey))) {
        event.preventDefault();
        resetClock();
      } else if (!mod && !event.altKey && event.shiftKey && key === 'a') {
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
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [fitView, fitPadding, screenToFlowPosition]);
};
