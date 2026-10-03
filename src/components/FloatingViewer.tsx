import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PictureInPicture2 } from 'lucide-react';

type Rect = { x: number; y: number; width: number; height: number };

/** Space kept between a window and the edge of the screen. */
const MARGIN = 16;
const MIN_WIDTH = 220;
const MIN_HEIGHT = 160;
/** How much of the title bar must stay on screen, so it can always be grabbed back. */
const KEEP_VISIBLE = 64;
/** Title bar height, for the first size: the picture's shape plus this. */
const HEAD_HEIGHT = 42;

/*
 * Where each viewer's window was, so floating it again puts it back where
 * it was left. For the session only: it is a place on this screen, not a
 * part of the document.
 */
const lastRects = new Map<string, Rect>();

const clampRect = (rect: Rect): Rect => {
  const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - MARGIN * 2);
  const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - MARGIN * 2);
  const width = Math.min(Math.max(rect.width, MIN_WIDTH), maxWidth);
  const height = Math.min(Math.max(rect.height, MIN_HEIGHT), maxHeight);
  const x = Math.min(Math.max(rect.x, KEEP_VISIBLE - width), window.innerWidth - KEEP_VISIBLE);
  const y = Math.min(Math.max(rect.y, 0), window.innerHeight - HEAD_HEIGHT);
  return { x, y, width, height };
};

/** First placement: the picture's shape, in the bottom-right corner. */
const initialRect = (ratio: number): Rect => {
  const width = Math.min(560, window.innerWidth * 0.5);
  const height = width / ratio + HEAD_HEIGHT;
  return clampRect({
    x: window.innerWidth - width - MARGIN,
    y: window.innerHeight - height - MARGIN,
    width,
    height,
  });
};

/** Which way an edge moves: -1 the left/top edge, 1 the right/bottom, 0 neither. */
type Edges = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

/** Every side and corner, each with the cursor that says which way it pulls. */
const HANDLES: { name: string; edges: Edges }[] = [
  { name: 'n', edges: { x: 0, y: -1 } },
  { name: 's', edges: { x: 0, y: 1 } },
  { name: 'e', edges: { x: 1, y: 0 } },
  { name: 'w', edges: { x: -1, y: 0 } },
  { name: 'ne', edges: { x: 1, y: -1 } },
  { name: 'nw', edges: { x: -1, y: -1 } },
  { name: 'se', edges: { x: 1, y: 1 } },
  { name: 'sw', edges: { x: -1, y: 1 } },
];

/**
 * One axis of a resize. Pulling the far edge just grows the size; pulling
 * the near one moves the origin with it, so the opposite edge stays put --
 * even once the size has hit its minimum.
 */
const resizeAxis = (start: number, size: number, delta: number, edge: -1 | 0 | 1, min: number) => {
  if (edge === 0) return { origin: start, size };
  if (edge === 1) return { origin: start, size: Math.max(min, size + delta) };
  const next = Math.max(min, size - delta);
  return { origin: start + size - next, size: next };
};

type Gesture = { kind: 'move' } | { kind: 'resize'; edges: Edges };
type Drag = Gesture & { startX: number; startY: number; start: Rect };

/**
 * A viewer's picture, lifted off the graph into a window over the page:
 * moved by its title bar, resized from any side or corner, and not panned or zoomed
 * with the canvas behind it. The viewer's card stays where it is in the
 * graph; this only shows what that card would.
 *
 * Mounted on the body rather than inside the node, or React Flow's viewport
 * transform would still scale and move it.
 */
export const FloatingViewer: React.FC<{
  nodeId: string;
  ratio: number;
  info: string;
  onDock: () => void;
  children: React.ReactNode;
}> = ({ nodeId, ratio, info, onDock, children }) => {
  const [rect, setRect] = useState<Rect>(() => clampRect(lastRects.get(nodeId) ?? initialRect(ratio)));
  const gesture = useRef<Drag | null>(null);

  useEffect(() => {
    lastRects.set(nodeId, rect);
  }, [nodeId, rect]);

  // A smaller window would otherwise leave this one partly off screen.
  useEffect(() => {
    const onResize = () => setRect((current) => clampRect(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const begin = (kind: Gesture) => (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // A press on the title bar's button is a click, not a move.
    if (kind.kind === 'move' && (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { ...kind, startX: event.clientX, startY: event.clientY, start: rect };
  };

  const track = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    const { start } = current;
    if (current.kind === 'move') {
      setRect(clampRect({ ...start, x: start.x + dx, y: start.y + dy }));
      return;
    }
    const x = resizeAxis(start.x, start.width, dx, current.edges.x, MIN_WIDTH);
    const y = resizeAxis(start.y, start.height, dy, current.edges.y, MIN_HEIGHT);
    setRect(clampRect({ x: x.origin, y: y.origin, width: x.size, height: y.size }));
  }, []);

  const end = useCallback((event: React.PointerEvent<HTMLElement>) => {
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const gestureHandlers = { onPointerMove: track, onPointerUp: end, onPointerCancel: end };

  return createPortal(
    <div
      className="floating-viewer glass"
      role="dialog"
      aria-label="Floating viewer"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      // React carries events up through a portal to the node it came from;
      // a click in here is not a click on the viewer's card.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="floating-viewer-head" onPointerDown={begin({ kind: 'move' })} {...gestureHandlers}>
        <span className="render-title">Viewer</span>
        <span className="render-info">{info}</span>
        <button
          type="button"
          className="floating-viewer-dock"
          onClick={onDock}
          title="Put the picture back on the card"
          aria-label="Put the picture back on the card"
        >
          <PictureInPicture2 size={14} />
        </button>
      </div>
      <div className="floating-viewer-stage">{children}</div>
      {HANDLES.map(({ name, edges }) => (
        <div
          key={name}
          className={`floating-viewer-edge is-${name}`}
          aria-hidden="true"
          onPointerDown={begin({ kind: 'resize', edges })}
          {...gestureHandlers}
        />
      ))}
    </div>,
    document.body,
  );
};
