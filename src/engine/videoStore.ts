/**
 * Decoded video elements, held outside the graph store.
 *
 * Like `imageStore`, the zustand store stays serializable. Nodes keep lightweight
 * metadata; the HTMLVideoElement instances live here, keyed by node id, and the
 * renderer streams frames directly from them.
 */

export type LoadedVideo = {
  element: HTMLVideoElement;
  width: number;
  height: number;
  duration: number;
  /** Object URL backing the node's video source. Revoked when the video is dropped. */
  url: string;
  name: string;
  /** Bumped on replacement or upload so the renderer can track updates. */
  version: number;
};

type Entry = { video: LoadedVideo; refs: number };

const videos = new Map<string, Entry>();
let versionCounter = 0;

export const getVideo = (nodeId: string): LoadedVideo | undefined => videos.get(nodeId)?.video;

export const putVideo = (
  nodeId: string,
  element: HTMLVideoElement,
  url: string,
  name: string,
  width: number,
  height: number,
  duration: number,
): LoadedVideo => {
  dropVideo(nodeId);
  versionCounter += 1;
  const loaded: LoadedVideo = {
    element,
    width,
    height,
    duration,
    url,
    name,
    version: versionCounter,
  };
  videos.set(nodeId, { video: loaded, refs: 1 });
  return loaded;
};

/** Let `toId` hold the same video as `fromId`. A no-op if there is none. */
export const shareVideo = (fromId: string, toId: string): void => {
  const entry = videos.get(fromId);
  if (!entry || fromId === toId) return;
  dropVideo(toId);
  entry.refs += 1;
  videos.set(toId, entry);
};

/** Exchange what two ids hold, for when two nodes trade identities. */
export const swapVideos = (a: string, b: string): void => {
  const entryA = videos.get(a);
  const entryB = videos.get(b);
  videos.delete(a);
  videos.delete(b);
  if (entryA) videos.set(b, entryA);
  if (entryB) videos.set(a, entryB);
};

export const dropVideo = (nodeId: string): void => {
  const entry = videos.get(nodeId);
  if (!entry) return;
  videos.delete(nodeId);
  entry.refs -= 1;
  if (entry.refs > 0) return;

  try {
    entry.video.element?.pause?.();
    entry.video.element?.removeAttribute?.('src');
    entry.video.element?.load?.();
  } catch {
    // Ignore cleanup errors on disposal
  }
  if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
    try {
      URL.revokeObjectURL(entry.video.url);
    } catch {
      // Ignore URL errors in test environments
    }
  }
};

/**
 * Instantiate and buffer an HTMLVideoElement from a File or Blob.
 */
export const createVideoElementFromFile = (
  file: File | Blob,
): Promise<{ element: HTMLVideoElement; url: string; width: number; height: number; duration: number }> => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    video.muted = true;
    video.loop = true;
    video.preload = 'auto';

    let resolved = false;

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };

    const onLoaded = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      const width = video.videoWidth || 640;
      const height = video.videoHeight || 360;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      resolve({ element: video, url, width, height, duration });
    };

    const onError = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode or play video file'));
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
    video.src = url;
    video.load();
  });
};
