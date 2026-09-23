import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Handle, Position, useReactFlow, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { useGraph } from '../state/store';
import {
  DEFAULT_PREVIEW_WIDTH,
  chainIsAnimated,
  findUpstreamRenderNode,
  resolveChain,
  type OutputNodeData,
} from '../state/graph';
import { Pipeline } from '../engine/pipeline';
import { createContext } from '../engine/gl';
import { clockSeconds, isPlaying, resetCount, subscribeClock } from '../engine/clock';
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

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

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
  const updateNodeInternals = useUpdateNodeInternals();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pipelineRef = useRef<Pipeline | null>(null);
  const lastFrameRef = useRef(performance.now());
  const frameRef = useRef(0);
  const [unsupported, setUnsupported] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  const [fps, setFps] = useState<number | null>(null);
  const fpsWindowRef = useRef({ frames: 0, since: 0 });
  const animatedRef = useRef(false);
  const lastLoopIndexRef = useRef<number | null>(null);

  // Check if connected to purple input (Render asset), including through any upstream pass-through viewers
  const upstreamRenderNode = findUpstreamRenderNode(nodes, edges, id);
  const isRenderMode = !!upstreamRenderNode;
  const renderAssetData = upstreamRenderNode?.data;
  const hasRenderedAsset = !!renderAssetData?.renderedBlob && !!renderAssetData?.renderedUrl;

  const chain = resolveChain(nodes, edges, id);
  const animated = chainIsAnimated(chain);
  const playing = useSyncExternalStore(subscribeClock, isPlaying);
  const resets = useSyncExternalStore(subscribeClock, resetCount);
  const isStillFormatter =
    chain?.formatter?.format === 'jpg' || chain?.formatter?.format === 'png';
  // The frame loop runs only for a chain that moves, and only while the
  // transport is playing (and not in rendered asset mode).
  const looping = !isRenderMode && !isStillFormatter && animated && playing;

  // Held in a ref so the draw callback can stay stable across node drags,
  // which change the nodes array without changing what gets rendered.
  const chainRef = useRef(chain);
  chainRef.current = chain;

  // Redraw when something the picture depends on changes, including upstream formatter settings.
  const signature = chain
    ? signatureOf(chain.plan) + (chain.formatter ? JSON.stringify(chain.formatter) : '')
    : 'empty';

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
    // Paused, no time passes: feedback effects hold their picture instead
    // of carrying on fading every time a knob change redraws the frame.
    const delta = isPlaying() ? Math.min((now - lastFrameRef.current) / 1000, MAX_DELTA) : 0;
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

    const rawTime = clockSeconds(now);
    let time = rawTime;

    if (current.formatter) {
      if (current.formatter.format === 'jpg' || current.formatter.format === 'png') {
        time = current.formatter.time;
      } else if (current.formatter.loopPreview) {
        const dur = Math.max(0.1, current.formatter.duration);
        const start = Math.max(0, current.formatter.time);
        const fps = Math.max(1, current.formatter.fps);
        const elapsed = Math.max(0, rawTime - start);
        const loopIndex = Math.floor(elapsed / dur);
        if (lastLoopIndexRef.current !== null && loopIndex !== lastLoopIndexRef.current) {
          pipeline.resetFeedback();
        }
        lastLoopIndexRef.current = loopIndex;

        // Step time in increments of 1/fps so playback cadence matches the target FPS
        const progressInLoop = elapsed % dur;
        const steppedProgress = Math.floor(progressInLoop * fps) / fps;
        time = start + steppedProgress;
      }
    }

    const primaryImage = getImage(current.sourceNodeId);
    const maxDim = primaryImage ? Math.max(primaryImage.width, primaryImage.height) : 2048;
    const targetWorkingSize = current.formatter
      ? Math.max(16, Math.round(maxDim * current.formatter.scale))
      : MAX_WORKING_SIZE;

    pipeline.render({
      plan: current.plan,
      images,
      primaryNodeId: current.sourceNodeId,
      time,
      delta,
      frame: frameRef.current,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      maxWorkingSize: targetWorkingSize,
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

    const onContextLost = (event: Event) => {
      event.preventDefault();
      setContextLost(true);
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
    };

    const onContextRestored = () => {
      setContextLost(false);
      const newGl = createContext(canvas);
      if (newGl) {
        pipelineRef.current = new Pipeline(newGl);
        drawRef.current();
      }
    };

    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    return () => {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
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
      updateNodeInternals(id);
      drawRef.current();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [id, updateNodeInternals]);

  useEffect(() => {
    draw();
  }, [draw, signature]);

  // Back to zero: trails and echoes start again from nothing, as they did
  // the first time, rather than carrying on over the reset.
  useEffect(() => {
    if (resets === 0) return;
    lastLoopIndexRef.current = null;
    pipelineRef.current?.resetFeedback();
    frameRef.current = 0;
    lastFrameRef.current = performance.now();
    drawRef.current();
  }, [resets]);

  // Paused or resumed: one draw either way, so the frame shown is the one
  // at the paused moment rather than whichever the loop last reached.
  useEffect(() => {
    lastLoopIndexRef.current = null;
    lastFrameRef.current = performance.now();
    drawRef.current();
  }, [playing]);

  useEffect(() => {
    animatedRef.current = looping;
    if (!looping) {
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
  }, [looping]);

  const image = chain ? getImage(chain.sourceNodeId) : undefined;
  const renderedRatio = renderAssetData?.renderedDimensions
    ? renderAssetData.renderedDimensions.width / renderAssetData.renderedDimensions.height
    : null;
  const ratio = isRenderMode
    ? renderedRatio ?? (image ? image.width / image.height : DEFAULT_RATIO)
    : image
      ? image.width / image.height
      : DEFAULT_RATIO;

  const displayWidth = isRenderMode
    ? renderAssetData?.renderedDimensions?.width ??
      (image ? Math.round(image.width * (renderAssetData?.scale ?? 1)) : 0)
    : image
      ? chain?.formatter
        ? Math.max(1, Math.round(image.width * chain.formatter.scale))
        : image.width
      : 0;

  const displayHeight = isRenderMode
    ? renderAssetData?.renderedDimensions?.height ??
      (image ? Math.round(image.height * (renderAssetData?.scale ?? 1)) : 0)
    : image
      ? chain?.formatter
        ? Math.max(1, Math.round(image.height * chain.formatter.scale))
        : image.height
      : 0;

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

  // Re-measure handle positions in React Flow when card dimensions, ratio, or mode change
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, width, ratio, isRenderMode, displayWidth, displayHeight, updateNodeInternals]);

  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      updateNodeInternals(id);
    });
    return () => cancelAnimationFrame(handle);
  }, [id, updateNodeInternals]);

  const stageStyle = { '--stage-ratio': ratio } as React.CSSProperties;

  return (
    <div className="node node-output" style={{ width }}>
      <div className="render-head">
        <span className="render-title">Viewer</span>
        <span className="render-info">
          {isRenderMode
            ? renderAssetData?.renderedDimensions
              ? `${renderAssetData.renderedDimensions.width} × ${renderAssetData.renderedDimensions.height}${renderAssetData.renderedSize ? ` · ${formatBytes(renderAssetData.renderedSize)}` : ''}`
              : renderAssetData
                ? renderAssetData.format.toUpperCase()
                : '—'
            : image
              ? `${displayWidth} × ${displayHeight}`
              : '—'}
        </span>
      </div>

      <div className="render-stage" style={stageStyle}>
        {isRenderMode ? (
          hasRenderedAsset ? (
            renderAssetData.format === 'mp4' || renderAssetData.format === 'webm' ? (
              <video
                key={renderAssetData.renderedUrl}
                src={renderAssetData.renderedUrl!}
                autoPlay
                loop
                muted
                playsInline
                className="render-canvas"
                style={{ objectFit: 'contain', width: '100%', height: '100%', pointerEvents: 'none' }}
              />
            ) : (
              <img
                key={renderAssetData.renderedUrl}
                src={renderAssetData.renderedUrl!}
                alt="Rendered Preview"
                className="render-canvas"
                style={{ objectFit: 'contain', width: '100%', height: '100%', pointerEvents: 'none' }}
              />
            )
          ) : renderAssetData?.rendering ? (
            <p className="render-empty">Rendering {renderAssetData.format.toUpperCase()} asset…</p>
          ) : (
            <p className="render-empty">
              Click <strong>Render</strong> on upstream node.
            </p>
          )
        ) : (
          <>
            <canvas ref={canvasRef} className="render-canvas" />
            {unsupported && <p className="render-empty">This browser has no WebGL2.</p>}
            {contextLost && <p className="render-empty">GPU context lost — restoring…</p>}
            {!unsupported && !contextLost && !chain && (
              <p className="render-empty">Wire an image in to see it here.</p>
            )}
          </>
        )}
      </div>

      <div className="render-foot">
        <span
          className={
            'render-dot' +
            (isRenderMode
              ? hasRenderedAsset
                ? ' is-live'
                : ''
              : chain
                ? ' is-live'
                : '')
          }
          style={isRenderMode && hasRenderedAsset ? { background: 'var(--port-render)' } : undefined}
        />
        <span>
          {isRenderMode
            ? hasRenderedAsset
              ? `Asset (${renderAssetData?.format.toUpperCase()})`
              : renderAssetData?.rendering
                ? 'Rendering…'
                : 'Awaiting Render'
            : chain
              ? isStillFormatter
                ? 'Still'
                : animated
                  ? playing
                    ? 'Playing'
                    : 'Paused'
                  : 'Live'
              : 'Idle'}
        </span>
        {isRenderMode && renderAssetData?.renderedSize && (
          <span className="render-fps" style={{ color: 'var(--port-render)', fontWeight: 600 }}>
            {formatBytes(renderAssetData.renderedSize)}
          </span>
        )}
        {!isRenderMode && looping && (
          <span className="render-fps">
            {fps !== null ? `${Math.round(fps)} fps` : ''}
          </span>
        )}
        {chain && !isRenderMode && (
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

      {/* Dual input: split circle (blue live picture / purple rendered asset) */}
      <Handle
        type="target"
        position={Position.Left}
        className="port port-in port-title port-dual"
        style={{ top: 22 }}
        title="Input (Live picture or Rendered asset)"
      />

      {/* Dual output: split circle (blue live picture / purple rendered asset) */}
      <Handle
        type="source"
        position={Position.Right}
        className="port port-out port-title port-dual"
        style={{ top: 22 }}
        title="Pass-through output (Live picture or Rendered asset)"
      />
    </div>
  );
};
