import type { RenderPlan } from './pipeline';
import { getImage, type LoadedImage } from './imageStore';
import { getVideo, type LoadedVideo } from './videoStore';

/*
 * The media a plan reads, looked up by node id. Null when one has gone since
 * the plan was resolved -- viewers hold a chain between renders, and an
 * image or video node can be deleted in that gap.
 */

export const imagesForPlan = (plan: RenderPlan): Map<string, LoadedImage> | null => {
  const images = new Map<string, LoadedImage>();
  for (const step of plan.steps) {
    if (step.kind !== 'image') continue;
    const image = getImage(step.nodeId);
    if (!image) return null;
    images.set(step.nodeId, image);
  }
  return images;
};

export const videosForPlan = (plan: RenderPlan): Map<string, LoadedVideo> | null => {
  const videos = new Map<string, LoadedVideo>();
  for (const step of plan.steps) {
    if (step.kind !== 'video') continue;
    const video = getVideo(step.nodeId);
    if (!video) return null;
    videos.set(step.nodeId, video);
  }
  return videos;
};
