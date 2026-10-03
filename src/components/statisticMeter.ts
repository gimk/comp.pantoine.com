import { useEffect } from 'react';
import { Pipeline } from '../engine/pipeline';
import { createContext } from '../engine/gl';
import { clockSeconds, isPlaying, subscribeClock } from '../engine/clock';
import { imagesForPlan, videosForPlan } from '../engine/planMedia';
import { setStatistics } from '../engine/statistics';
import { chainIsAnimated, generatorsForPlan, type ResolvedChain } from '../state/graph';

/**
 * Image Statistic nodes taking their own readings.
 *
 * A viewer measures a statistic as part of its frame when something it
 * draws reads one, so a knob follows the picture on that same frame. But a
 * statistic nothing on screen reads would never be measured at all, and
 * its card would sit at 0. So each card also hands its picture's chain to
 * this meter, which renders it small, off screen, and measures it.
 *
 * One hidden canvas and one pipeline serve every card: browsers only allow
 * a handful of live WebGL contexts, and the viewers need them more.
 */

/** The side of the hidden canvas; the measurement samples a 64x64 grid anyway. */
const CANVAS_SIZE = 64;
/** Working size the chains are rendered at: enough for the picture to read true, cheap enough to run per card. */
const WORKING_SIZE = 512;
/** Longest frame step handed to feedback effects, as in the viewers. */
const MAX_DELTA = 0.1;

const watched = new Map<string, ResolvedChain | null>();

let canvas: HTMLCanvasElement | null = null;
let pipeline: Pipeline | null = null;
let frame = 0;
let lastFrame = performance.now();
let scheduled = 0;

const ensurePipeline = (): Pipeline | null => {
  if (pipeline) return pipeline;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      pipeline?.dispose();
      pipeline = null;
    });
    canvas.addEventListener('webglcontextrestored', schedule);
  }
  const gl = createContext(canvas);
  if (!gl || gl.isContextLost()) return null;
  pipeline = new Pipeline(gl);
  return pipeline;
};

const measureAll = (): void => {
  scheduled = 0;
  if (watched.size === 0) return;

  const now = performance.now();
  const delta = isPlaying() ? Math.min((now - lastFrame) / 1000, MAX_DELTA) : 0;
  lastFrame = now;
  frame += 1;
  const time = clockSeconds(now);

  let moving = false;
  for (const [nodeId, chain] of watched) {
    const images = chain ? imagesForPlan(chain.plan) : null;
    const videos = chain ? videosForPlan(chain.plan) : null;
    // Nothing to measure: the reading goes back to 0 rather than holding
    // on to whatever was wired in before.
    if (!chain || !images || !videos) {
      setStatistics(nodeId, [0, 0, 0, 0, 0]);
      continue;
    }
    const target = ensurePipeline();
    if (!target) return;
    target.render({
      plan: chain.plan,
      images,
      videos,
      generators: generatorsForPlan(chain.plan),
      primaryNodeId: chain.sourceNodeId,
      time,
      delta,
      frame,
      canvasWidth: CANVAS_SIZE,
      canvasHeight: CANVAS_SIZE,
      maxWorkingSize: WORKING_SIZE,
    });
    if (chainIsAnimated(chain)) moving = true;
  }
  // A moving picture is measured every frame while the transport plays.
  if (moving && isPlaying()) schedule();
};

const schedule = (): void => {
  if (!scheduled) scheduled = requestAnimationFrame(measureAll);
};

// Play, pause and back to zero all change what a moving picture shows.
subscribeClock(schedule);

/**
 * Keep an Image Statistic measuring its own picture for as long as its
 * card is mounted. `chain` is the node's own, from `useResolvedChain`, and
 * changes identity only when the picture does.
 */
export const useStatisticMeter = (nodeId: string, chain: ResolvedChain | null): void => {
  useEffect(() => {
    watched.set(nodeId, chain);
    schedule();
    return () => {
      watched.delete(nodeId);
    };
  }, [nodeId, chain]);
};
