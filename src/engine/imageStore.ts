/**
 * Decoded bitmaps, held outside the graph store.
 *
 * The zustand store stays serializable so the graph can be saved later, and
 * so a slider drag does not push megabytes of pixel data through React's
 * reconciler. Nodes keep a lightweight descriptor; the pixels live here,
 * keyed by node id, and the renderer pulls them straight out.
 */

export type LoadedImage = {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** Object URL backing the node's thumbnail. Revoked when the image goes. */
  url: string;
  name: string;
  /** Bumped on replacement so the renderer knows to re-upload the texture. */
  version: number;
};

/*
 * Entries are shared, not copied. A duplicated image node points at the same
 * decoded bitmap as the one it came from -- decoding again would need the
 * file, which is long gone -- so each entry counts the ids holding it and is
 * only released when the last of them lets go.
 */
type Entry = { image: LoadedImage; refs: number };

const images = new Map<string, Entry>();
let versionCounter = 0;

/**
 * Decode into the orientation WebGL wants, which is upside down from the way
 * the file is stored.
 *
 * The flip has to happen here rather than at upload: `UNPACK_FLIP_Y_WEBGL` is
 * silently ignored for `ImageBitmap` sources, so asking for it at
 * `texImage2D` time leaves the picture inverted. Doing it at decode keeps one
 * rule for the whole renderer -- every texture is already in GL orientation,
 * so no pass, intermediate target or read-back has to flip again.
 */
export const decodeImage = (source: Blob | HTMLCanvasElement): Promise<ImageBitmap> =>
  createImageBitmap(source, { imageOrientation: 'flipY' });

export const getImage = (nodeId: string): LoadedImage | undefined => images.get(nodeId)?.image;

export const putImage = (
  nodeId: string,
  bitmap: ImageBitmap,
  url: string,
  name: string,
): LoadedImage => {
  dropImage(nodeId);
  versionCounter += 1;
  const loaded: LoadedImage = {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    url,
    name,
    version: versionCounter,
  };
  images.set(nodeId, { image: loaded, refs: 1 });
  return loaded;
};

/** Let `toId` hold the same image as `fromId`. A no-op if there is none. */
export const shareImage = (fromId: string, toId: string): void => {
  const entry = images.get(fromId);
  if (!entry || fromId === toId) return;
  dropImage(toId);
  entry.refs += 1;
  images.set(toId, entry);
};

/** Exchange what two ids hold, for when two nodes trade identities. */
export const swapImages = (a: string, b: string): void => {
  const entryA = images.get(a);
  const entryB = images.get(b);
  images.delete(a);
  images.delete(b);
  if (entryA) images.set(b, entryA);
  if (entryB) images.set(a, entryB);
};

export const dropImage = (nodeId: string): void => {
  const entry = images.get(nodeId);
  if (!entry) return;
  images.delete(nodeId);
  entry.refs -= 1;
  if (entry.refs > 0) return;
  URL.revokeObjectURL(entry.image.url);
  entry.image.bitmap.close();
};
