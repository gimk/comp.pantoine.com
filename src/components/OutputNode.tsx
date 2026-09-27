import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, useReactFlow, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { useGraph } from '../state/store';
import { DEFAULT_PREVIEW_WIDTH, generatorsForPlan, type OutputNodeData } from '../state/graph';
import { isRendering } from '../state/renderJobs';
import { getImage } from '../engine/imageStore';
import { getVideo } from '../engine/videoStore';
import { useResolvedChain, useUpstreamRender, useViewerPipeline } from './viewerPipeline';
import { formatBytes, formatLabel, isMotionExtension } from './format';

/** Shape of the empty frame, before there is a picture to take one from. */
const DEFAULT_RATIO = 16 / 9;

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

const assetMediaStyle: React.CSSProperties = {
  objectFit: 'contain',
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
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
 *
 * Wired to a Render node along purple wires, it shows the baked file
 * instead, and its canvas -- and with it the GL context -- goes away.
 */
export const OutputNode: React.FC<NodeProps<Node<OutputNodeData, 'renderOutput'>>> = ({
  id,
  data,
}) => {
  const setPreviewWidth = useGraph((state) => state.setPreviewWidth);
  const { getZoom } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  const { renderId, settings: renderSettings, job } = useUpstreamRender(id);
  const isRenderMode = !!renderId;
  const asset = job.asset;
  const rendering = isRendering(job);

  const view = useResolvedChain(id);
  const { chain } = view;

  const [fps, setFps] = useState<number | null>(null);
  const onResize = useCallback(() => updateNodeInternals(id), [id, updateNodeInternals]);

  const { canvasRef, unsupported, contextLost, animated, still, playing, looping } = useViewerPipeline({
    view,
    live: !isRenderMode,
    onFps: setFps,
    onResize,
  });

  const planGenerators = useMemo(() => (chain ? generatorsForPlan(chain.plan) : new Map()), [chain]);
  const source = chain
    ? getImage(chain.sourceNodeId) ?? getVideo(chain.sourceNodeId) ?? planGenerators.get(chain.sourceNodeId)
    : undefined;
  const sourceRatio = source ? source.width / source.height : DEFAULT_RATIO;
  const ratio = isRenderMode && asset ? asset.width / asset.height : sourceRatio;

  // In render mode, before anything is baked, the size the Render node is
  // about to produce; live, the size the chain works at.
  const scale = isRenderMode ? renderSettings?.scale ?? 1 : chain?.formatter?.scale ?? 1;
  const displayWidth = isRenderMode && asset ? asset.width : source ? Math.max(1, Math.round(source.width * scale)) : 0;
  const displayHeight =
    isRenderMode && asset ? asset.height : source ? Math.max(1, Math.round(source.height * scale)) : 0;

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
  const requestedLabel = renderSettings ? formatLabel(renderSettings.format) : null;

  return (
    <div className="node node-output" style={{ width }}>
      <div className="render-head">
        <span className="render-title">Viewer</span>
        <span className="render-info">
          {isRenderMode
            ? asset
              ? `${asset.width} × ${asset.height} · ${formatBytes(asset.blob.size)}`
              : requestedLabel ?? '—'
            : source
              ? `${displayWidth} × ${displayHeight}`
              : '—'}
        </span>
      </div>

      <div className="render-stage" style={stageStyle}>
        {isRenderMode ? (
          asset ? (
            isMotionExtension(asset.extension) ? (
              <video
                key={asset.url}
                src={asset.url}
                autoPlay
                loop
                muted
                playsInline
                className="render-canvas"
                style={assetMediaStyle}
              />
            ) : (
              <img
                key={asset.url}
                src={asset.url}
                alt="Rendered Preview"
                className="render-canvas"
                style={assetMediaStyle}
              />
            )
          ) : rendering ? (
            <p className="render-empty">Rendering {requestedLabel} asset…</p>
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
          className={'render-dot' + ((isRenderMode ? asset : chain) ? ' is-live' : '')}
          style={isRenderMode && asset ? { background: 'var(--port-render)' } : undefined}
        />
        <span>
          {isRenderMode
            ? rendering
              ? asset
                ? 'Re-rendering…'
                : 'Rendering…'
              : asset
                ? `Asset (${formatLabel(asset.extension)})`
                : 'Awaiting Render'
            : chain
              ? still
                ? 'Still'
                : animated
                  ? playing
                    ? 'Playing'
                    : 'Paused'
                  : 'Live'
              : 'Idle'}
        </span>
        {isRenderMode && asset && (
          <span className="render-fps" style={{ color: 'var(--port-render)', fontWeight: 600 }}>
            {formatBytes(asset.blob.size)}
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
