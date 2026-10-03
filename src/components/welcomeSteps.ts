/*
 * The welcome tour, one entry per page. Clips live in public/welcome/,
 * taken from the app itself: retake them when the nodes they show change.
 */

/**
 * Bump when a clip is replaced: browsers keep parts of a video they have
 * streamed, and a new file under the old URL gets spliced onto the old one.
 */
const CLIP_VERSION = 2;

export interface WelcomeStep {
  title: string;
  body: string;
  video: string;
  alt: string;
}

export const WELCOME_STEPS: WelcomeStep[] = [
  {
    title: 'Welcome to Comp',
    body:
      "Comp lets you build a picture step by step. You start with an image, pass it through a few effects, " +
      'and watch the result update live. Each step is a node, and wires connect them from left to right.',
    video: `/welcome/step-1.mp4?v=${CLIP_VERSION}`,
    alt: 'A small graph: an image wired through two effects into a viewer.',
  },
  {
    title: 'Bring in an image',
    body:
      'Drop an image or a video straight onto the canvas, or paste one from your clipboard. ' +
      'You can also pick Image from the Input menu at the top left.',
    video: `/welcome/step-2.mp4?v=${CLIP_VERSION}`,
    alt: 'An image node on the canvas showing a photo.',
  },
  {
    title: 'Connect your first nodes',
    body:
      'Add an effect from the Module menu, or press Shift+A anywhere on the canvas. Drag a wire from the ' +
      "image's port into the effect, then into a Viewer from the Output menu to see what you made.",
    video: `/welcome/step-3.mp4?v=${CLIP_VERSION}`,
    alt: 'An image wired into an effect, then into a viewer showing the result.',
  },
  {
    title: 'Export your work',
    body:
      'Happy with it? Wire your chain into a Render node, choose a format and hit Render. ' +
      'Then connect an Exporter to download the file.',
    video: `/welcome/step-4.mp4?v=${CLIP_VERSION}`,
    alt: 'A Render node wired into an Exporter with a finished file ready to download.',
  },
];
