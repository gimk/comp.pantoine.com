import React, { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGraph } from '../state/store';
import type { Node } from '@xyflow/react';
import type { AppNode, BackgroundNodeData } from '../state/graph';
import { MAX_WORKING_SIZE, useResolvedChain, useUpstreamRender, useViewerPipeline } from './viewerPipeline';
import { isMotionExtension } from './format';

/** Widest the chain may work at behind the whole window. */
const MAX_SCREEN_WORKING_SIZE = 2560;

/**
 * The Background node that owns the screen: the selected one if it is
 * enabled, otherwise the first enabled one.
 */
const activeBackground = (nodes: AppNode[]): Node<BackgroundNodeData, 'backgroundOutput'> | undefined => {
  let first: Node<BackgroundNodeData, 'backgroundOutput'> | undefined;
  for (const node of nodes) {
    if (node.type !== 'backgroundOutput' || node.data.enabled === false) continue;
    if (node.selected) return node;
    first ??= node;
  }
  return first;
};

/**
 * The picture behind the canvas, drawn by whichever Background node is
 * active.
 *
 * The same pipeline as a viewer, filling the window instead of a card: the
 * working size tracks the screen rather than a fixed cap, and the frame is
 * cropped to fill or letterboxed to fit as the node says.
 */
export const FullScreenBackground: React.FC = () => {
  const setBackgroundFps = useGraph((state) => state.setBackgroundFps);

  // Primitives only, so a node drag that leaves the background alone does
  // not re-render it.
  const active = useGraph(
    useShallow((state) => {
      const node = activeBackground(state.nodes);
      return { id: node?.id ?? null, fit: node?.data.fit, opacity: node?.data.opacity ?? 1 };
    }),
  );

  const isEnabled = active.id !== null;
  const fitMode: 'contain' | 'cover' =
    active.fit === 'fit' || active.fit === 'contain' ? 'contain' : 'cover';

  const { renderId, job } = useUpstreamRender(active.id);
  const isRenderMode = !!renderId;
  const asset = job.asset;

  const view = useResolvedChain(active.id, isEnabled && !isRenderMode);

  const liveWorkingSize = useCallback(
    (canvas: HTMLCanvasElement) => Math.max(MAX_WORKING_SIZE, Math.min(canvas.width, MAX_SCREEN_WORKING_SIZE)),
    [],
  );

  const { canvasRef } = useViewerPipeline({
    view,
    live: isEnabled && !isRenderMode,
    fitMode,
    liveWorkingSize,
    onFps: setBackgroundFps,
  });

  if (!isEnabled) return null;

  return (
    <div className="fullscreen-background" style={{ opacity: active.opacity }} aria-hidden="true">
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
              className="fullscreen-background-media"
              style={{ objectFit: fitMode }}
            />
          ) : (
            <img
              key={asset.url}
              src={asset.url}
              alt="Background Render"
              className="fullscreen-background-media"
              style={{ objectFit: fitMode }}
            />
          )
        ) : null
      ) : (
        <canvas ref={canvasRef} className="fullscreen-background-canvas" />
      )}
    </div>
  );
};
