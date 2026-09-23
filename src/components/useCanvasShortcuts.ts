import { useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { redo, undo } from '../state/history';
import { setSnapping, useGraph } from '../state/store';

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
 *   Shift (while dragging) snap to other modules' centres
 *
 * Alt-drag duplication and Shift-click selection are pointer gestures and
 * live on the ReactFlow props instead.
 */
export const useCanvasShortcuts = (fitPadding: number): void => {
  const { fitView, screenToFlowPosition } = useReactFlow();
  const pointer = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      // Also caught here, so a Shift pressed before the window had focus
      // still counts once the pointer moves.
      setSnapping(event.shiftKey);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      setSnapping(event.shiftKey);
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
      } else if (!mod && !event.altKey && key === 'f') {
        const selected = store.nodes.filter((node) => node.selected);
        void fitView({
          nodes: selected.length > 0 ? selected.map((node) => ({ id: node.id })) : undefined,
          padding: fitPadding,
          duration: 220,
        });
      }
    };

    const onKeyUp = (event: KeyboardEvent) => setSnapping(event.shiftKey);
    // A Shift released while another window had focus never reports back.
    const onBlur = () => setSnapping(false);

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
