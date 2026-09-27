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
  /** Object URL backing the node's video source. Revoked when the last element using it goes. */
  url: string;
  name: string;
  /** Bumped on replacement or upload so the renderer can track updates. */
  version: number;
};

/*
 * Two levels of sharing, because a video, unlike a bitmap, has state.
 *
 * An element is a playhead: its loop flag, rate and current time belong to
 * one node, so two live nodes must never hold the same one -- a duplicate
 * gets an element of its own (`cloneVideo`) on the same object URL. Holders
 * that only keep a video for later -- undo snapshots, the clipboard -- share
 * the element itself (`shareVideo`), since they never play it.
 *
 * The object URL under the elements is counted separately and revoked when
 * the last element built on it is disposed.
 */
type Source = { url: string; refs: number };
type Entry = { video: LoadedVideo; refs: number; source: Source };

const videos = new Map<string, Entry>();
let versionCounter = 0;

export const getVideo = (nodeId: string): LoadedVideo | undefined => videos.get(nodeId)?.video;

const newVideoElement = (url: string): HTMLVideoElement => {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.playsInline = true;
  video.muted = true;
  video.loop = true;
  video.preload = 'auto';
  video.src = url;
  return video;
};

const disposeElement = (element: HTMLVideoElement): void => {
  try {
    element?.pause?.();
    element?.removeAttribute?.('src');
    element?.load?.();
  } catch {
    // Ignore cleanup errors on disposal
  }
};

const revoke = (url: string): void => {
  if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore URL errors in test environments
    }
  }
};

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
  videos.set(nodeId, { video: loaded, refs: 1, source: { url, refs: 1 } });
  return loaded;
};

/**
 * Let `toId` hold the same element as `fromId`, for a holder that will not
 * play it. A no-op if there is none.
 */
export const shareVideo = (fromId: string, toId: string): void => {
  const entry = videos.get(fromId);
  if (!entry || fromId === toId) return;
  dropVideo(toId);
  entry.refs += 1;
  videos.set(toId, entry);
};

/**
 * Give `toId` an element of its own on the same source as `fromId`, set up
 * the same way -- for a copy that will play independently. A no-op if there
 * is none.
 */
export const cloneVideo = (fromId: string, toId: string): void => {
  const entry = videos.get(fromId);
  if (!entry || fromId === toId) return;
  const element = newVideoElement(entry.source.url);
  element.loop = entry.video.element.loop;
  element.playbackRate = entry.video.element.playbackRate;
  element.load?.();
  entry.source.refs += 1;
  dropVideo(toId);
  versionCounter += 1;
  videos.set(toId, {
    video: { ...entry.video, element, version: versionCounter },
    refs: 1,
    source: entry.source,
  });
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

/**
 * Stop a node's element where it is. Called when the node leaves the graph:
 * an undo snapshot may still hold the element, so dropping it does not
 * necessarily dispose of it, and nothing would otherwise stop it playing.
 */
export const pauseVideo = (nodeId: string): void => {
  try {
    videos.get(nodeId)?.video.element?.pause?.();
  } catch {
    // Nothing to stop.
  }
};

/** Apply a node's playback settings to its element. */
export const configureVideo = (nodeId: string, settings: { loop?: boolean; speed?: number }): void => {
  const element = videos.get(nodeId)?.video.element;
  if (!element) return;
  if (settings.loop !== undefined) element.loop = settings.loop;
  if (settings.speed !== undefined && Number.isFinite(settings.speed) && settings.speed > 0) {
    element.playbackRate = Math.min(16, Math.max(0.0625, settings.speed));
  }
};

export const dropVideo = (nodeId: string): void => {
  const entry = videos.get(nodeId);
  if (!entry) return;
  videos.delete(nodeId);
  entry.refs -= 1;
  if (entry.refs > 0) return;

  disposeElement(entry.video.element);
  entry.source.refs -= 1;
  if (entry.source.refs <= 0) revoke(entry.source.url);
};

/** Throw away an element that was loaded but never stored -- a superseded load. */
export const discardVideo = (element: HTMLVideoElement, url: string): void => {
  disposeElement(element);
  revoke(url);
};

/**
 * Instantiate and buffer an HTMLVideoElement from a File or Blob.
 */
export const createVideoElementFromFile = (
  file: File | Blob,
): Promise<{ element: HTMLVideoElement; url: string; width: number; height: number; duration: number }> => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = newVideoElement(url);

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
    video.load();
  });
};
