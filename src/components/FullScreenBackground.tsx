import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { Node } from '@xyflow/react';
import { useGraph } from '../state/store';
import {
  chainIsAnimated,
  findUpstreamRenderNode,
  resolveChain,
  type BackgroundNodeData,
} from '../state/graph';
import { Pipeline, type RenderPlan } from '../engine/pipeline';
import { createContext } from '../engine/gl';
import { clockSeconds, isPlaying, resetCount, subscribeClock } from '../engine/clock';
import { getImage, type LoadedImage } from '../engine/imageStore';
import { signalKey } from '../engine/modulators';

const MAX_DPR = 2;
const MAX_WORKING_SIZE = 2048;
const MAX_DELTA = 0.1;
const FPS_WINDOW_MS = 500;

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

export const FullScreenBackground: React.FC = () => {
  const nodes = useGraph((state) => state.nodes);
  const edges = useGraph((state) => state.edges);
  const setBackgroundFps = useGraph((state) => state.setBackgroundFps);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pipelineRef = useRef<Pipeline | null>(null);
  const lastFrameRef = useRef(performance.now());
  const frameRef = useRef(0);
  const fpsWindowRef = useRef({ frames: 0, since: 0 });
  const animatedRef = useRef(false);
  const lastLoopIndexRef = useRef<number | null>(null);

  // Find active background node: prefer selected if enabled, else the first enabled node
  const bgNodes = nodes.filter(
    (n): n is Node<BackgroundNodeData, 'backgroundOutput'> => n.type === 'backgroundOutput',
  );
  const activeNode = bgNodes.find((n) => n.selected && n.data.enabled !== false) ??
    bgNodes.find((n) => n.data.enabled !== false);

  const activeNodeId = activeNode?.id;
  const isEnabled = !!activeNode && activeNode.data.enabled !== false;
  const fitMode: 'contain' | 'cover' = activeNode?.data.fit === 'fit' || (activeNode?.data.fit as string) === 'contain' ? 'contain' : 'cover';
  const opacity = activeNode?.data.opacity ?? 1;

  // Upstream render asset check
  const upstreamRenderNode = activeNodeId ? findUpstreamRenderNode(nodes, edges, activeNodeId) : null;
  const isRenderMode = !!upstreamRenderNode;
  const renderAssetData = upstreamRenderNode?.data;
  const hasRenderedAsset = !!renderAssetData?.renderedBlob && !!renderAssetData?.renderedUrl;

  const chain = activeNodeId && !isRenderMode ? resolveChain(nodes, edges, activeNodeId) : null;
  const animated = chainIsAnimated(chain);
  const playing = useSyncExternalStore(subscribeClock, isPlaying);
  const resets = useSyncExternalStore(subscribeClock, resetCount);
  const isStillFormatter =
    chain?.formatter?.format === 'jpg' || chain?.formatter?.format === 'png';
  const looping = isEnabled && !isRenderMode && !isStillFormatter && animated && playing;

  const chainRef = useRef(chain);
  chainRef.current = chain;

  const fitModeRef = useRef(fitMode);
  fitModeRef.current = fitMode;

  const signature = chain
    ? signatureOf(chain.plan) + (chain.formatter ? JSON.stringify(chain.formatter) : '') + fitMode
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
    const delta = isPlaying() ? Math.min((now - lastFrameRef.current) / 1000, MAX_DELTA) : 0;
    lastFrameRef.current = now;
    frameRef.current += 1;

    if (animatedRef.current) {
      const window = fpsWindowRef.current;
      window.frames += 1;
      const elapsed = now - window.since;
      if (elapsed >= FPS_WINDOW_MS) {
        setBackgroundFps((window.frames * 1000) / elapsed);
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

        const progressInLoop = elapsed % dur;
        const steppedProgress = Math.floor(progressInLoop * fps) / fps;
        time = start + steppedProgress;
      }
    }

    const primaryImage = getImage(current.sourceNodeId);
    const maxDim = primaryImage ? Math.max(primaryImage.width, primaryImage.height) : 2048;
    const targetWorkingSize = current.formatter
      ? Math.max(16, Math.round(maxDim * current.formatter.scale))
      : Math.max(MAX_WORKING_SIZE, Math.min(canvas.width, 2560));

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
      fitMode: fitModeRef.current,
    });
  }, [setBackgroundFps]);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  // Initialize WebGL context and pipeline for the full screen canvas
  useEffect(() => {
    if (!isEnabled || isRenderMode) {
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = createContext(canvas);
    if (!gl) return;

    pipelineRef.current = new Pipeline(gl);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
    };

    const onContextRestored = () => {
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
  }, [isEnabled, isRenderMode]);

  // ResizeObserver to match drawing buffer to full screen container layout size
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !isEnabled || isRenderMode) return;

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

    observer.observe(container);
    return () => observer.disconnect();
  }, [isEnabled, isRenderMode]);

  useEffect(() => {
    if (isEnabled && !isRenderMode) {
      draw();
    }
  }, [draw, isEnabled, isRenderMode, signature]);

  useEffect(() => {
    if (resets === 0) return;
    lastLoopIndexRef.current = null;
    pipelineRef.current?.resetFeedback();
    frameRef.current = 0;
    lastFrameRef.current = performance.now();
    drawRef.current();
  }, [resets]);

  useEffect(() => {
    lastLoopIndexRef.current = null;
    lastFrameRef.current = performance.now();
    drawRef.current();
  }, [playing]);

  useEffect(() => {
    animatedRef.current = looping;
    if (!looping) {
      setBackgroundFps(null);
      return;
    }

    fpsWindowRef.current = { frames: 0, since: performance.now() };
    let frame = 0;
    const tick = () => {
      drawRef.current();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setBackgroundFps(null);
    };
  }, [looping, setBackgroundFps]);

  if (!isEnabled) return null;

  return (
    <div
      ref={containerRef}
      className="fullscreen-background"
      style={{ opacity }}
      aria-hidden="true"
    >
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
              className="fullscreen-background-media"
              style={{ objectFit: fitMode }}
            />
          ) : (
            <img
              key={renderAssetData.renderedUrl}
              src={renderAssetData.renderedUrl!}
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
