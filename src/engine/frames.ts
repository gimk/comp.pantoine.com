/**
 * The size and shape of every picture a plan makes.
 *
 * There used to be one frame for the whole graph -- the source at the head
 * of the main path's -- and every step ran in it. A Resize/Crop node breaks
 * that: everything after it on the main path is a different picture, of a
 * size it chose. So each step has a frame of its own, in source pixels:
 *
 *   - an image, video or generator heading the main path keeps its own;
 *   - an effect takes its main input's, unless it defines a new one
 *     (`EffectDef.frame`), which is what Resize/Crop does;
 *   - a picture read on the side -- a mask, a map, a field -- is made in
 *     the frame of the node reading it, the way a second image was always
 *     fitted to the one frame. That holds back through effects on that
 *     side branch, but not through a Resize, which keeps the size it chose.
 *
 * A picture read by two nodes of different frames is made for one of them;
 * the pipeline cover-fits it for the other when it binds it.
 *
 * Worked out at render time rather than in the graph, since the size of an
 * image is only known once it has loaded.
 */
import { defaultParams } from './effects';
import type { RenderPlan, Step } from './pipeline';

export type Frame = { width: number; height: number };

/** The frame of a flat value, or a per-pixel Math, with nothing else to size it. */
export const FALLBACK_FRAME: Frame = { width: 1280, height: 720 };

/** Whatever the media in a plan measure; the sizes a plan cannot know itself. */
export type FrameSources = {
  image: (nodeId: string) => Frame | undefined;
  video: (nodeId: string) => Frame | undefined;
};

/** Steps a step reads, split by whether they set its frame or are fitted to it. */
const readsOf = (step: Step): { main: number | null; side: number[] } => {
  switch (step.kind) {
    case 'effect':
      return {
        main: step.pass.def.frame ? null : step.input,
        side: [
          ...(step.pass.def.frame ? [step.input] : []),
          ...step.extras.filter((extra): extra is number => extra !== null),
          ...step.fields.map((field) => field.step),
        ],
      };
    case 'generator':
      return { main: null, side: step.fields.map((field) => field.step) };
    case 'fieldOp':
      return { main: null, side: Object.values(step.ports).flatMap((port) => ('step' in port ? [port.step] : [])) };
    default:
      return { main: null, side: [] };
  }
};

const clampFrame = (frame: Frame): Frame => ({
  width: Math.max(1, Math.round(frame.width)),
  height: Math.max(1, Math.round(frame.height)),
});

/**
 * Each step's frame, by step index. Null only for a step that draws no
 * picture (a statistic) or one whose media is missing.
 */
export const planFrames = (plan: RenderPlan, sources: FrameSources): (Frame | null)[] => {
  const { steps } = plan;

  // What each step would be on its own, front to back: inputs come first.
  const native: (Frame | null)[] = [];
  steps.forEach((step, index) => {
    let frame: Frame | null = null;
    switch (step.kind) {
      case 'image':
        frame = sources.image(step.nodeId) ?? null;
        break;
      case 'video':
        frame = sources.video(step.nodeId) ?? null;
        break;
      case 'generator':
        frame = { width: step.width, height: step.height };
        break;
      case 'fill':
        frame = FALLBACK_FRAME;
        break;
      case 'fieldOp': {
        const first = Object.values(step.ports).find((port): port is { step: number } => 'step' in port);
        frame = (first && native[first.step]) || FALLBACK_FRAME;
        break;
      }
      case 'effect': {
        const input = native[step.input];
        const def = step.pass.def;
        if (input && def.frame) frame = clampFrame(def.frame(input, { ...defaultParams(def), ...step.pass.params }));
        else frame = input;
        break;
      }
      case 'statistic':
        frame = null;
        break;
    }
    native[index] = frame;
  });

  // Back to front: a step settles its own frame, then tells what it reads.
  const wanted: (Frame | null)[] = steps.map(() => null);
  const frames: (Frame | null)[] = steps.map(() => null);
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    // A frame-defining effect, and a source heading the main path, keep
    // their own; everything else is made to the size it is wanted at.
    const keepsOwn = step.kind === 'effect' && !!step.pass.def.frame;
    const frame = keepsOwn ? native[index] : wanted[index] ?? native[index];
    frames[index] = frame;
    if (!frame) continue;
    const { main, side } = readsOf(step);
    if (main !== null) wanted[main] ??= frame;
    for (const read of side) {
      // A Resize's own input is read raw: it is the picture being resized.
      if (step.kind === 'effect' && step.pass.def.frame && read === step.input) continue;
      wanted[read] ??= frame;
    }
  }
  return frames;
};

/** Whether two frames have the same shape, so one can be sampled as the other. */
export const sameShape = (a: Frame, b: Frame): boolean =>
  Math.abs(a.width / a.height - b.width / b.height) < 1e-3;
