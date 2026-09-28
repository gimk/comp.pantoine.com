import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useGraph } from '../state/store';
import {
  chainIsAnimated,
  findUpstreamRenderNode,
  generatorsForPlan,
  resolveChain,
  type RenderNodeData,
  type ResolvedChain,
} from '../state/graph';
import { useRenderJob, type RenderJob } from '../state/renderJobs';
import { Pipeline, type RenderRequest } from '../engine/pipeline';
import { createContext } from '../engine/gl';
import { clockSeconds, isPlaying, resetCount, subscribeClock } from '../engine/clock';
import { getImage } from '../engine/imageStore';
import { getVideo, type LoadedVideo } from '../engine/videoStore';
import { evaluateSignal, signalKey } from '../engine/modulators';
import { imagesForPlan, videosForPlan } from '../engine/planMedia';

/*
 * What the node viewer and the full-screen background have in common.
 *
 * Both are a canvas with its own GL context and pipeline, drawing a chain
 * resolved from one node id, redrawing when the picture's signature changes
 * and looping only while something in it moves. They differ in where the
 * canvas sits, how the frame is fitted and where the frame rate is shown --
 * which is all that is left to them.
 */

type GraphState = ReturnType<typeof useGraph.getState>;

/** Retina is worth it; beyond 2x is pixels nobody can see. */
const MAX_DPR = 2;

/**
 * Longest edge the effect chain runs at.
 *
 * Atomic modules mean long chains -- a CRT look is eight full-screen passes
 * -- so this is what keeps a large photo interactive. It caps the working
 * buffers only; the source image is untouched.
 */
export const MAX_WORKING_SIZE = 2048;

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
 * What the picture depends on, as a string that changes when it does.
 *
 * Built by hand rather than by stringifying the plan: a pass carries its
 * whole effect definition, shader source included, and serializing that on
 * every store change of every viewer would be the slowest thing on the
 * canvas. Image versions are in it so that loading a new picture into the
 * same node redraws. Pass ids and seeds are in it because the resolved
 * chain is reused for as long as this string holds, and feedback history
 * is keyed by pass id.
 */
export const chainSignature = (chain: ResolvedChain): string => {
  const { plan, videoModulation, formatter } = chain;
  return JSON.stringify([
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
                step.pass.nodeId,
                step.pass.seed,
                step.pass.def.id,
                step.pass.params,
                step.width,
                step.height,
                Object.entries(step.pass.modulation).map(([key, signal]) => [key, signalKey(signal)]),
                step.fields,
              ]
            : step.kind === 'fill'
              ? ['fill', step.nodeId, signalKey(step.signal)]
              : step.kind === 'fieldOp'
                ? [
                    'fieldOp',
                    step.nodeId,
                    step.def.id,
                    step.params,
                    Object.entries(step.ports).map(([key, port]) => [
                      key,
                      'step' in port ? port.step : signalKey(port.signal),
                    ]),
                  ]
                : step.kind === 'statistic'
                  ? ['statistic', step.nodeId, step.input]
                  : [
                      step.pass.nodeId,
                      step.pass.seed,
                      step.pass.def.id,
                      step.pass.params,
                      step.input,
                      step.extras,
                      Object.entries(step.pass.modulation).map(([key, signal]) => [key, signalKey(signal)]),
                      step.fields,
                    ],
    ),
    formatter ?? null,
  ]);
};

export type ViewedChain = { chain: ResolvedChain | null; signature: string };

const NO_CHAIN: ViewedChain = { chain: null, signature: 'empty' };

/**
 * The chain one node sees, re-rendering only when the picture changes.
 *
 * Resolving is cheap next to a React render of a viewer, and the store
 * changes on every frame of a node drag; so the chain is resolved in the
 * selector and the previous object handed back for as long as its signature
 * holds. A drag then costs a walk of the graph and nothing else.
 */
export const useResolvedChain = (nodeId: string | null | undefined, enabled = true): ViewedChain => {
  const memo = useRef<ViewedChain>(NO_CHAIN);
  const select = useCallback(
    (state: GraphState): ViewedChain => {
      const chain = nodeId && enabled ? resolveChain(state.nodes, state.edges, nodeId) : null;
      const signature = chain ? chainSignature(chain) : NO_CHAIN.signature;
      if (signature !== memo.current.signature) memo.current = chain ? { chain, signature } : NO_CHAIN;
      return memo.current;
    },
    [nodeId, enabled],
  );
  return useGraph(select);
};

export type UpstreamRender = {
  /** The Render node feeding this one along purple wires, if any. */
  renderId: string | null;
  settings: RenderNodeData | undefined;
  job: RenderJob;
};

/**
 * The baked asset reaching a node, and the settings of the node baking it.
 *
 * Each piece is its own narrow subscription: the id is a string and the
 * settings are the node's own data object, which a drag leaves untouched,
 * so moving things around does not re-render anything reading this.
 */
export const useUpstreamRender = (nodeId: string | null | undefined): UpstreamRender => {
  const renderId = useGraph((state) =>
    nodeId ? findUpstreamRenderNode(state.nodes, state.edges, nodeId)?.id ?? null : null,
  );
  const settings = useGraph((state) => {
    if (!renderId) return undefined;
    const node = state.nodes.find((n) => n.id === renderId);
    return node?.type === 'render' ? node.data : undefined;
  });
  const job = useRenderJob(renderId);
  return { renderId, settings, job };
};

/** Whether the chain is pinned to one frame by a still format upstream. */
export const isStillChain = (chain: ResolvedChain | null): boolean =>
  chain?.formatter?.format === 'jpg' || chain?.formatter?.format === 'png';

/**
 * Per-frame control of the shared video elements a chain reads: speed from
 * the node or its modulation, and looping.
 *
 * These elements are shared by every viewer; an export decodes through its
 * own, so nothing here can pull frames out from under a render in progress.
 */
const driveVideos = (videos: Map<string, LoadedVideo>, chain: ResolvedChain, time: number): void => {
  if (videos.size === 0) return;
  const graphNodes = useGraph.getState().nodes;
  for (const [videoId, video] of videos) {
    const element = video.element;
    const modulation = chain.videoModulation?.get(videoId);
    const node = graphNodes.find((n) => n.id === videoId);
    const videoData = node?.type === 'video' ? node.data : undefined;
    const duration = element.duration || videoData?.duration || 1;
    const loop = videoData?.loop !== false;

    let targetSpeed = 1;
    if (modulation?.speed) {
      targetSpeed = Math.max(0, evaluateSignal(modulation.speed, time));
    } else if (typeof videoData?.speed === 'number') {
      targetSpeed = Math.max(0, videoData.speed);
    } else if (typeof videoData?.playbackRate === 'number') {
      targetSpeed = Math.max(0, videoData.playbackRate);
    }

    if (targetSpeed <= 0.001) {
      if (!element.paused) element.pause();
    } else {
      element.playbackRate = Math.min(16, Math.max(0.0625, targetSpeed));
      if (isPlaying() && element.paused && !element.ended) {
        void element.play().catch(() => {});
      }
    }

    if (loop && (element.ended || (duration > 0 && element.currentTime >= duration - 0.05))) {
      element.currentTime = 0;
      if (isPlaying()) void element.play().catch(() => {});
    }
  }
};

/*
 * Contexts waiting to be released, by canvas.
 *
 * Released a tick after the effect lets go rather than straight away:
 * StrictMode tears effects down and runs them again on the same canvas, and
 * a context lost on purpose in between would leave that canvas blank. A
 * canvas that really has gone is released on the next tick, instead of
 * whenever the collector gets to it -- browsers only allow a handful of
 * live contexts, and the oldest is the one they take back.
 */
const pendingRelease = new WeakMap<HTMLCanvasElement, ReturnType<typeof setTimeout>>();

type ViewerOptions = {
  view: ViewedChain;
  /** False while the canvas is not shown; the loop and the video sync stand down. */
  live: boolean;
  fitMode?: RenderRequest['fitMode'];
  /** Working size when no Render node upstream sets one. */
  liveWorkingSize?: (canvas: HTMLCanvasElement) => number;
  onFps: (fps: number | null) => void;
  /** After the drawing buffer is resized to its layout size. */
  onResize?: () => void;
};

/**
 * A GL pipeline drawing one chain into whichever canvas it is handed.
 *
 * The canvas comes in through a callback ref and is held as state, so the
 * context lives exactly as long as the element does: a viewer that swaps
 * its canvas out for a baked asset and back gets a fresh context on the
 * new one, rather than keeping a pipeline bound to a canvas that has left
 * the page.
 */
export const useViewerPipeline = ({ view, live, fitMode, liveWorkingSize, onFps, onResize }: ViewerOptions) => {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipelineRef = useRef<Pipeline | null>(null);
  const lastFrameRef = useRef(performance.now());
  const frameRef = useRef(0);
  const fpsWindowRef = useRef({ frames: 0, since: 0 });
  const animatedRef = useRef(false);
  const lastLoopIndexRef = useRef<number | null>(null);

  const { chain, signature } = view;
  const animated = useMemo(() => chainIsAnimated(chain), [chain]);
  const still = isStillChain(chain);
  const playing = useSyncExternalStore(subscribeClock, isPlaying);
  const resets = useSyncExternalStore(subscribeClock, resetCount);
  // The frame loop runs only for a chain that moves, and only while the
  // transport is playing and the canvas is on screen.
  const looping = live && !still && animated && playing;

  // Read through a ref so the draw callback can stay stable: it is called
  // from the frame loop, the resize observer and context restore alike.
  const latest = useRef({ chain, fitMode, liveWorkingSize, onFps, onResize });
  latest.current = { chain, fitMode, liveWorkingSize, onFps, onResize };

  const draw = useCallback(() => {
    const target = canvasRef.current;
    const pipeline = pipelineRef.current;
    if (!target || !pipeline) return;

    const { chain: current, fitMode: fit, liveWorkingSize: workingSize } = latest.current;
    const images = current ? imagesForPlan(current.plan) : null;
    const videos = current ? videosForPlan(current.plan) : null;
    if (!current || !images || !videos) {
      pipeline.clear(target.width, target.height);
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
        latest.current.onFps((window.frames * 1000) / elapsed);
        window.frames = 0;
        window.since = now;
      }
    }

    const rawTime = clockSeconds(now);
    let time = rawTime;
    const settings = current.formatter;

    if (settings) {
      if (settings.format === 'jpg' || settings.format === 'png') {
        time = settings.time;
      } else if (settings.loopPreview) {
        const duration = Math.max(0.1, settings.duration);
        const start = Math.max(0, settings.time);
        const fps = Math.max(1, settings.fps);
        const elapsed = Math.max(0, rawTime - start);
        const loopIndex = Math.floor(elapsed / duration);
        if (lastLoopIndexRef.current !== null && loopIndex !== lastLoopIndexRef.current) {
          pipeline.resetFeedback();
          for (const video of videos.values()) video.element.currentTime = start;
        }
        lastLoopIndexRef.current = loopIndex;

        // Step time in increments of 1/fps so playback cadence matches the target FPS.
        const progressInLoop = elapsed % duration;
        time = start + Math.floor(progressInLoop * fps) / fps;
      }
    }

    const generators = generatorsForPlan(current.plan);
    const primarySource =
      getImage(current.sourceNodeId) ?? getVideo(current.sourceNodeId) ?? generators.get(current.sourceNodeId);
    const maxDim = primarySource ? Math.max(primarySource.width, primarySource.height) : MAX_WORKING_SIZE;
    const maxWorkingSize = settings
      ? Math.max(16, Math.round(maxDim * settings.scale))
      : workingSize?.(target) ?? MAX_WORKING_SIZE;

    driveVideos(videos, current, time);

    pipeline.render({
      plan: current.plan,
      images,
      videos,
      generators,
      primaryNodeId: current.sourceNodeId,
      time,
      delta,
      frame: frameRef.current,
      canvasWidth: target.width,
      canvasHeight: target.height,
      maxWorkingSize,
      fitMode: fit,
    });
  }, []);

  // Context and pipeline, for the life of this canvas element.
  useEffect(() => {
    if (!canvas) return;
    const pending = pendingRelease.get(canvas);
    if (pending !== undefined) {
      clearTimeout(pending);
      pendingRelease.delete(canvas);
    }

    const gl = createContext(canvas);
    if (!gl) {
      setUnsupported(true);
      return;
    }
    setUnsupported(false);
    canvasRef.current = canvas;

    const build = () => {
      pipelineRef.current?.dispose();
      pipelineRef.current = new Pipeline(gl);
      draw();
    };

    const onContextLost = (event: Event) => {
      // Without this the browser will not offer the context back.
      event.preventDefault();
      setContextLost(true);
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
    };

    const onContextRestored = () => {
      setContextLost(false);
      build();
    };

    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    // A context can already be gone when handed over; the restore event
    // is then what builds the pipeline.
    if (gl.isContextLost()) {
      setContextLost(true);
    } else {
      setContextLost(false);
      build();
    }

    return () => {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
      if (canvasRef.current === canvas) canvasRef.current = null;
      pendingRelease.set(
        canvas,
        setTimeout(() => {
          pendingRelease.delete(canvas);
          gl.getExtension('WEBGL_lose_context')?.loseContext();
        }, 0),
      );
    };
  }, [canvas, draw]);

  /*
   * Match the drawing buffer to the canvas's layout size.
   *
   * `contentRect` rather than a bounding rect: a node sits inside React
   * Flow's transformed viewport, so a bounding rect reports the zoomed size
   * and every scroll of the wheel would reallocate the buffers. Layout size
   * is stable across zoom, and the browser scales the result.
   */
  useEffect(() => {
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
      latest.current.onResize?.();
      draw();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvas, draw]);

  // Redraw when something the picture depends on changes.
  useEffect(() => {
    draw();
  }, [draw, signature, fitMode]);

  // Shared video elements follow the transport while this viewer is live.
  useEffect(() => {
    if (!live) return;
    const current = latest.current.chain;
    const videos = current ? videosForPlan(current.plan) : null;
    if (!videos) return;
    for (const video of videos.values()) {
      if (playing) {
        if (video.element.paused && !video.element.ended) void video.element.play().catch(() => {});
      } else if (!video.element.paused) {
        video.element.pause();
      }
    }
  }, [live, playing, signature]);

  const lastResetsRef = useRef(resets);

  // Back to zero: trails and echoes start again from nothing, as they did
  // the first time, rather than carrying on over the reset.
  useEffect(() => {
    if (lastResetsRef.current === resets) return;
    lastResetsRef.current = resets;
    if (resets === 0) return;
    lastLoopIndexRef.current = null;
    pipelineRef.current?.resetFeedback();
    const current = latest.current.chain;
    const videos = current ? videosForPlan(current.plan) : null;
    if (videos) for (const video of videos.values()) video.element.currentTime = 0;
    frameRef.current = 0;
    lastFrameRef.current = performance.now();
    draw();
  }, [draw, resets]);

  // Paused or resumed: one draw either way, so the frame shown is the one
  // at the paused moment rather than whichever the loop last reached.
  useEffect(() => {
    lastLoopIndexRef.current = null;
    lastFrameRef.current = performance.now();
    draw();
  }, [draw, playing]);

  useEffect(() => {
    animatedRef.current = looping;
    if (!looping) {
      // Cleared rather than left frozen, which would read as a live
      // measurement of a stopped renderer.
      latest.current.onFps(null);
      return;
    }

    fpsWindowRef.current = { frames: 0, since: performance.now() };
    let frame = 0;
    const tick = () => {
      draw();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      latest.current.onFps(null);
    };
  }, [draw, looping]);

  return { canvasRef: setCanvas, unsupported, contextLost, animated, still, playing, looping };
};
