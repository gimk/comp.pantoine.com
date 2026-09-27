import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { Node } from '@xyflow/react';
import { useGraph } from '../state/store';
import {
  chainIsAnimated,
  findUpstreamRenderNode,
  generatorsForPlan,
  resolveChain,
  type BackgroundNodeData,
} from '../state/graph';
import { Pipeline, type RenderPlan } from '../engine/pipeline';
import { createContext } from '../engine/gl';
import { clockSeconds, isPlaying, resetCount, subscribeClock } from '../engine/clock';
import { getImage, type LoadedImage } from '../engine/imageStore';
import { getVideo, type LoadedVideo } from '../engine/videoStore';
import { evaluateSignal, signalKey, type Signal } from '../engine/modulators';

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

const videosFor = (plan: RenderPlan): Map<string, LoadedVideo> | null => {
  const videos = new Map<string, LoadedVideo>();
  for (const step of plan.steps) {
    if (step.kind !== 'video') continue;
    const video = getVideo(step.nodeId);
    if (!video) return null;
    videos.set(step.nodeId, video);
  }
  return videos;
};

const signatureOf = (plan: RenderPlan, videoModulation?: Map<string, Record<string, Signal>>): string =>
  JSON.stringify([
    plan.output,
    plan.steps.map((step) =>
      step.kind === 'image'
        ? [step.nodeId, getImage(step.nodeId)?.version]
        : step.kind === 'video'
          ? [
              step.nodeId,
              getVideo(step.nodeId)?.version,
              videoModulation?.get(step.nodeId)
                ? Object.entries(videoModulation.get(step.nodeId)!).map(([k, s]) => [k, signalKey(s)])
                : null,
            ]
          : step.kind === 'generator'
            ? [
                step.nodeId,
                step.pass.def.id,
                step.pass.params,
                step.width,
                step.height,
                Object.entries(step.pass.modulation).map(([key, signal]) => [key, signalKey(signal)]),
              ]
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
    ? signatureOf(chain.plan, chain.videoModulation) + (chain.formatter ? JSON.stringify(chain.formatter) : '') + fitMode
    : 'empty';

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const pipeline = pipelineRef.current;
    if (!canvas || !pipeline) return;

    const current = chainRef.current;
    const images = current ? imagesFor(current.plan) : null;
    const videos = current ? videosFor(current.plan) : null;
    if (!current || !images || !videos) {
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
          if (videos.size > 0) {
            for (const v of videos.values()) {
              v.element.currentTime = start;
            }
          }
        }
        lastLoopIndexRef.current = loopIndex;

        const progressInLoop = elapsed % dur;
        const steppedProgress = Math.floor(progressInLoop * fps) / fps;
        time = start + steppedProgress;
      }
    }

    const generators = generatorsForPlan(current.plan);
    const primarySource =
      getImage(current.sourceNodeId) ?? getVideo(current.sourceNodeId) ?? generators.get(current.sourceNodeId);
    const maxDim = primarySource ? Math.max(primarySource.width, primarySource.height) : 2048;
    const targetWorkingSize = current.formatter
      ? Math.max(16, Math.round(maxDim * current.formatter.scale))
      : Math.max(MAX_WORKING_SIZE, Math.min(canvas.width, 2560));

    if (videos.size > 0) {
      for (const [vId, v] of videos.entries()) {
        const vMod = current.videoModulation?.get(vId);
        const node = nodes.find((n) => n.id === vId);
        const videoData = node?.type === 'video' ? node.data : undefined;
        const duration = v.element.duration || videoData?.duration || 1;
        const loop = videoData?.loop !== false;

        let targetSpeed = 1;
        if (vMod?.speed) {
          targetSpeed = Math.max(0, evaluateSignal(vMod.speed, time));
        } else if (typeof videoData?.speed === 'number') {
          targetSpeed = Math.max(0, videoData.speed);
        } else if (typeof videoData?.playbackRate === 'number') {
          targetSpeed = Math.max(0, videoData.playbackRate);
        }

        if (targetSpeed <= 0.001) {
          if (!v.element.paused) v.element.pause();
        } else {
          v.element.playbackRate = Math.min(16, Math.max(0.0625, targetSpeed));
          if (isPlaying() && v.element.paused && !v.element.ended) {
            void v.element.play().catch(() => {});
          }
        }

        if (v.element.ended || (loop && duration > 0 && v.element.currentTime >= duration - 0.05)) {
          if (loop) {
            v.element.currentTime = 0;
            if (isPlaying()) {
              void v.element.play().catch(() => {});
            }
          }
        }
      }
    }

    pipeline.render({
      plan: current.plan,
      images,
      videos,
      generators,
      primaryNodeId: current.sourceNodeId,
      time,
      delta,
      frame: frameRef.current,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      maxWorkingSize: targetWorkingSize,
      fitMode: fitModeRef.current,
    });
  }, [nodes, setBackgroundFps]);

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

  // Synchronize video element playback with transport playing state
  useEffect(() => {
    if (!chain || !isEnabled || isRenderMode) return;
    const vids = videosFor(chain.plan);
    if (!vids || vids.size === 0) return;
    for (const [, v] of vids.entries()) {
      if (playing) {
        if (v.element.paused && !v.element.ended) {
          void v.element.play().catch(() => {});
        }
      } else {
        if (!v.element.paused) {
          v.element.pause();
        }
      }
    }
  }, [chain, isEnabled, isRenderMode, playing, signature]);

  const lastResetsRef = useRef(resets);

  useEffect(() => {
    if (lastResetsRef.current === resets) return;
    lastResetsRef.current = resets;
    if (resets === 0) return;
    lastLoopIndexRef.current = null;
    pipelineRef.current?.resetFeedback();
    if (chain) {
      const vids = videosFor(chain.plan);
      if (vids) {
        for (const v of vids.values()) {
          v.element.currentTime = 0;
        }
      }
    }
    frameRef.current = 0;
    lastFrameRef.current = performance.now();
    drawRef.current();
  }, [resets, chain]);

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
