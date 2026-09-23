import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Handle, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import { useGraph } from '../state/store';
import {
  DEFAULT_PREVIEW_WIDTH,
  chainIsAnimated,
  resolveChain,
  type OutputNodeData,
} from '../state/graph';
import { Pipeline } from '../engine/pipeline';
import { createContext } from '../engine/gl';
import { clockSeconds } from '../engine/clock';
import { getImage, type LoadedImage } from '../engine/imageStore';
import type { RenderPlan } from '../engine/pipeline';
import { signalKey } from '../engine/modulators';

/**
 * Every image a plan reads, or null if one has gone since it was resolved
 * -- the chain is held in a ref between renders, and an image node can be
 * deleted in that gap.
 */
const imagesFor = (plan: RenderPlan): Map<string, LoadedImage> | null => {
  const images = new Map<string, LoadedImage>();
  for (const step of plan.steps) {
    if (step.kind !== 'image') continue;
    const image = getImage(step.nodeId);
    if (!image) return null;
    images.set(step.nodeId, image);
  }
  return images;
};

/**
 * What the picture depends on, as a string that changes when it does.
 *
 * Built by hand rather than by stringifying the plan: a pass carries its
 * whole effect definition, shader source included, and serializing that on
 * every render of every viewer would be the slowest thing on the canvas.
 * Image versions are in it so that loading a new picture into the same
 * node redraws.
 */
const signatureOf = (plan: RenderPlan): string =>
  JSON.stringify([
    plan.output,
    plan.steps.map((step) =>
      step.kind === 'image'
        ? [step.nodeId, getImage(step.nodeId)?.version]
        : [
            step.pass.def.id,
            step.pass.params,
            step.input,
            step.extras,
            Object.entries(step.pass.modulation).map(([key, signal]) => [key, signalKey(signal)]),
          ],
    ),
  ]);

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

const MIN_PREVIEW_WIDTH = 160;
const MAX_PREVIEW_WIDTH = 880;

/**
 * Tallest the picture may get.
 *
 * Applied by capping the width the ratio is allowed to reach rather than by
 * limiting the height, so the frame never stops matching the image's shape.
 * A portrait ends up a narrow card instead of a tower.
 */
const MAX_PREVIEW_HEIGHT = 520;

/**
 * The sink, and the picture itself.
 *
 * The render lives in the graph rather than in a panel beside it: the output
 * of a chain is a thing in the chain, and putting it anywhere else means
 * looking in two places to answer one question.
 *
 * Each viewer owns its own GL context, pipeline and frame loop, and resolves
 * its own chain from its own id -- so two of them can watch different
 * branches at once. That is the point of being able to add them, but it is
 * not free: every viewer holds its own working buffers and its own copy of
 * the source texture, so a handful is fine and a dozen is not.
 *
 * The loop runs continuously only when something in the chain is animated.
 * A graph of flat effects redraws on change and then sits idle, which is
 * what keeps a laptop fan quiet while nodes are being arranged.
 */
export const OutputNode: React.FC<NodeProps<Node<OutputNodeData, 'renderOutput'>>> = ({
  id,
  data,
}) => {
  const nodes = useGraph((state) => state.nodes);
  const edges = useGraph((state) => state.edges);
  const setPreviewWidth = useGraph((state) => state.setPreviewWidth);
  const { getZoom } = useReactFlow();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pipelineRef = useRef<Pipeline | null>(null);
  const lastFrameRef = useRef(performance.now());
  const frameRef = useRef(0);
  const [unsupported, setUnsupported] = useState(false);

  const [fps, setFps] = useState<number | null>(null);
  const fpsWindowRef = useRef({ frames: 0, since: 0 });
  const animatedRef = useRef(false);

  const chain = resolveChain(nodes, edges, id);
  const animated = chainIsAnimated(chain);

  // Held in a ref so the draw callback can stay stable across node drags,
  // which change the nodes array without changing what gets rendered.
  const chainRef = useRef(chain);
  chainRef.current = chain;

  // Redraw only when something the picture depends on actually moved.
  const signature = chain ? signatureOf(chain.plan) : 'empty';

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const pipeline = pipelineRef.current;
    if (!canvas || !pipeline) return;

    const current = chainRef.current;
    const images = current ? imagesFor(current.plan) : null;
    if (!current || !images) {
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
      plan: current.plan,
      images,
      primaryNodeId: current.sourceNodeId,
      time: clockSeconds(now),
      delta,
      frame: frameRef.current,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      maxWorkingSize: MAX_WORKING_SIZE,
    });
  }, []);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  // Context and pipeline, once for the life of the node.
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

  /*
   * Match the drawing buffer to the canvas's layout size.
   *
   * `contentRect` rather than a bounding rect: the node sits inside React
   * Flow's transformed viewport, so a bounding rect reports the zoomed size
   * and every scroll of the wheel would reallocate the buffers. Layout size
   * is stable across zoom, and the browser scales the result.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const width = Math.max(1, Math.round(box.width * dpr));
      const height = Math.max(1, Math.round(box.height * dpr));
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
  const ratio = image ? image.width / image.height : DEFAULT_RATIO;

  // Width is the only stored dimension; the height follows from the ratio,
  // and the ratio is also what caps how wide the card may get.
  const width = Math.max(
    MIN_PREVIEW_WIDTH,
    Math.min(data.width, MAX_PREVIEW_WIDTH, MAX_PREVIEW_HEIGHT * ratio),
  );

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const beginResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startWidth: width };
  }, [width]);

  const trackResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      // The pointer moves in screen pixels; the node lives in graph units,
      // so the travel has to be divided back through the current zoom.
      const travel = (event.clientX - drag.startX) / (getZoom() || 1);
      setPreviewWidth(id, drag.startWidth + travel);
    },
    [getZoom, id, setPreviewWidth],
  );

  const endResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  // A drag-only control is unusable without a pointer, so the grip also
  // takes arrow keys once focused.
  const nudgeResize = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 48 : 16;
      if (event.key === 'ArrowRight') setPreviewWidth(id, width + step);
      else if (event.key === 'ArrowLeft') setPreviewWidth(id, width - step);
      else return;
      event.preventDefault();
    },
    [id, setPreviewWidth, width],
  );

  const stageStyle = { '--stage-ratio': ratio } as React.CSSProperties;

  return (
    <div className="node node-output" style={{ width }}>
      <div className="render-head">
        <span className="render-title">Viewer</span>
        <span className="render-info">{image ? image.width + ' × ' + image.height : '—'}</span>
      </div>

      <div className="render-stage" style={stageStyle}>
        <canvas ref={canvasRef} className="render-canvas" />
        {unsupported && <p className="render-empty">This browser has no WebGL2.</p>}
        {!unsupported && !chain && <p className="render-empty">Wire an image in to see it here.</p>}
      </div>

      <div className="render-foot">
        <span className={'render-dot' + (chain ? ' is-live' : '')} />
        <span>{chain ? (animated ? 'Playing' : 'Live') : 'Idle'}</span>
        {animated && fps !== null && <span className="render-fps">{Math.round(fps)} fps</span>}
        {chain && (
          <span className="render-chain">
            {chain.passes.length} effect{chain.passes.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* nodrag, or dragging the grip would drag the whole card instead. */}
      <div
        className="render-grip nodrag"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize preview"
        tabIndex={0}
        onPointerDown={beginResize}
        onPointerMove={trackResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onKeyDown={nudgeResize}
        onDoubleClick={() => setPreviewWidth(id, DEFAULT_PREVIEW_WIDTH)}
        title="Drag to resize · double-click to reset"
      />

      <Handle type="target" position={Position.Left} className="port port-in" />
      {/* A viewer passes its input straight through, so it can sit part-way
          along a chain with more work after it. */}
      <Handle type="source" position={Position.Right} className="port port-out" />
    </div>
  );
};
