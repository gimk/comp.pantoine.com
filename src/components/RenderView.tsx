import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGraph } from '../state/store';
import { chainIsAnimated, resolveChain } from '../state/graph';
import { Pipeline } from '../engine/pipeline';
import { createContext } from '../engine/gl';
import { getImage } from '../engine/imageStore';

/** Retina is worth it; beyond 2x is pixels nobody can see. */
const MAX_DPR = 2;

/** Shape of the empty frame, before there is a picture to take one from. */
const DEFAULT_RATIO = 16 / 9;

/**
 * Longest edge the effect chain runs at.
 *
 * Atomic modules mean long chains -- a CRT look is eight full-screen passes
 * -- so this is what keeps a large photo interactive. It caps the working
 * buffers only; the source image is untouched.
 */
const MAX_WORKING_SIZE = 2048;

/**
 * Seconds before `u_time` wraps.
 *
 * `highp float` carries about seven significant digits, so an app left open
 * for hours would quantise `sin(u_time * rate)` into visible steps. Wrapping
 * trades that for one discontinuity every ~17 minutes, which is the better
 * of the two artefacts by a wide margin.
 */
const TIME_WRAP = 1000;

/** Longest delta handed to a shader, so a backgrounded tab does not
 *  resume with a single multi-second step. */
const MAX_DELTA = 0.1;

/**
 * How often the frame rate readout is recalculated.
 *
 * Averaged over this window rather than taken from the last frame: a
 * per-frame figure flickers through a range of values too fast to read, and
 * the point of the number is to be read.
 */
const FPS_WINDOW_MS = 500;

/**
 * The fixed panel on the right: whatever is wired into the Output node.
 *
 * Owns the GL context and the frame loop. The loop only runs continuously
 * when something in the chain is animated -- a graph of flat effects redraws
 * on change and then sits idle, which is what keeps a laptop fan quiet while
 * the user is just arranging nodes.
 */
export const RenderView: React.FC = () => {
  const nodes = useGraph((state) => state.nodes);
  const edges = useGraph((state) => state.edges);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const pipelineRef = useRef<Pipeline | null>(null);
  const startRef = useRef(performance.now());
  const lastFrameRef = useRef(performance.now());
  const frameRef = useRef(0);
  const [unsupported, setUnsupported] = useState(false);

  /*
   * Frame rate, measured only while the chain is animated. On a still chain
   * the renderer draws on demand, so frames-per-second would be a count of
   * how often a slider moved rather than anything about performance.
   */
  const [fps, setFps] = useState<number | null>(null);
  const fpsWindowRef = useRef({ frames: 0, since: 0 });
  const animatedRef = useRef(false);

  // null means "however wide the ratio and the default want it". Only the
  // width is ever stored: the stage derives its height from the ratio, so
  // there is no second dimension to hold, and nothing to keep in step.
  const [userWidth, setUserWidth] = useState<number | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const beginResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const aside = asideRef.current;
    if (!aside) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Measured rather than taken from state, so a drag that starts from the
    // default width picks up exactly where the frame is now.
    dragRef.current = { startX: e.clientX, startWidth: aside.getBoundingClientRect().width };
  }, []);

  const trackResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // The card is anchored right, so dragging the grip left widens it. The
    // bounds live in the CSS clamp, which already knows where the ratio
    // stops fitting.
    setUserWidth(drag.startWidth + (drag.startX - e.clientX));
  }, []);

  const endResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  // A drag-only control is unusable without a pointer, so the grip also
  // takes arrow keys once focused.
  const nudgeResize = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const aside = asideRef.current;
    if (!aside) return;
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') {
      setUserWidth(aside.getBoundingClientRect().width + step);
    } else if (e.key === 'ArrowRight') {
      setUserWidth(aside.getBoundingClientRect().width - step);
    } else {
      return;
    }
    e.preventDefault();
  }, []);

  const chain = resolveChain(nodes, edges);
  const animated = chainIsAnimated(chain);

  // Held in a ref so the draw callback can stay stable across node drags,
  // which change the nodes array without changing what gets rendered.
  const chainRef = useRef(chain);
  chainRef.current = chain;

  // Redraw only when something the picture depends on actually moved.
  const signature = chain
    ? JSON.stringify([chain.sourceNodeId, chain.passes.map((pass) => [pass.def.id, pass.params])])
    : 'empty';

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const pipeline = pipelineRef.current;
    if (!canvas || !pipeline) return;

    const current = chainRef.current;
    const image = current ? getImage(current.sourceNodeId) : undefined;
    if (!current || !image) {
      pipeline.clear(canvas.width, canvas.height);
      return;
    }

    const now = performance.now();
    const delta = Math.min((now - lastFrameRef.current) / 1000, MAX_DELTA);
    lastFrameRef.current = now;
    frameRef.current += 1;

    if (animatedRef.current) {
      const window = fpsWindowRef.current;
      window.frames += 1;
      const elapsed = now - window.since;
      if (elapsed >= FPS_WINDOW_MS) {
        setFps((window.frames * 1000) / elapsed);
        window.frames = 0;
        window.since = now;
      }
    }

    pipeline.render({
      nodeId: current.sourceNodeId,
      image,
      passes: current.passes,
      time: ((now - startRef.current) / 1000) % TIME_WRAP,
      delta,
      frame: frameRef.current,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      maxWorkingSize: MAX_WORKING_SIZE,
    });
  }, []);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  // Context and pipeline, once for the life of the panel.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = createContext(canvas);
    if (!gl) {
      setUnsupported(true);
      return;
    }
    pipelineRef.current = new Pipeline(gl);
    return () => {
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
    };
  }, []);

  // Match the drawing buffer to the panel's on-screen size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      drawRef.current();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    draw();
  }, [draw, signature]);

  useEffect(() => {
    animatedRef.current = animated;
    if (!animated) {
      // Clear it rather than leaving the last figure frozen on screen,
      // which would read as a live measurement of a stopped renderer.
      setFps(null);
      return;
    }

    fpsWindowRef.current = { frames: 0, since: performance.now() };
    let frame = 0;
    const tick = () => {
      drawRef.current();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animated]);

  const image = chain ? getImage(chain.sourceNodeId) : undefined;

  /*
   * The frame takes the picture's shape rather than the picture being
   * letterboxed inside a fixed one, so the panel hugs its content and the
   * checkerboard only ever shows where the image is genuinely transparent.
   */
  const stageStyle = {
    '--stage-ratio': image ? image.width / image.height : DEFAULT_RATIO,
  } as React.CSSProperties;

  /*
   * The dragged width goes on the card only. The ratio has to reach the
   * stage as well, so it stays on both rather than relying on inheritance.
   */
  const panelStyle = {
    ...stageStyle,
    ...(userWidth === null ? {} : { '--render-user-width': Math.round(userWidth) + 'px' }),
  } as React.CSSProperties;

  return (
    <aside className="glass render-view" ref={asideRef} style={panelStyle}>
      <div
        className="render-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize render frame"
        tabIndex={0}
        onPointerDown={beginResize}
        onPointerMove={trackResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onKeyDown={nudgeResize}
        onDoubleClick={() => setUserWidth(null)}
        title="Drag to resize · double-click to reset"
      />

      <header className="render-head">
        <span className="render-title">Render</span>
        <span className="render-info">
          {image ? image.width + ' × ' + image.height : '—'}
        </span>
      </header>

      <div className="render-stage" style={stageStyle}>
        <canvas ref={canvasRef} className="render-canvas" />
        {unsupported && <p className="render-empty">This browser has no WebGL2.</p>}
        {!unsupported && !chain && (
          <p className="render-empty">
            Wire an image into the <strong>Output</strong> node to see it here.
          </p>
        )}
      </div>

      <footer className="render-foot">
        <span className={'render-dot' + (chain ? ' is-live' : '')} />
        <span>{chain ? (animated ? 'Playing' : 'Live') : 'Idle'}</span>
        {animated && fps !== null && <span className="render-fps">{Math.round(fps)} fps</span>}
        {chain && <span className="render-chain">{chain.passes.length} effect{chain.passes.length === 1 ? '' : 's'}</span>}
      </footer>
    </aside>
  );
};
