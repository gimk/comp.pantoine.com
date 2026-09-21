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

const images = new Map<string, LoadedImage>();
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

export const getImage = (nodeId: string): LoadedImage | undefined => images.get(nodeId);

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
  images.set(nodeId, loaded);
  return loaded;
};

export const dropImage = (nodeId: string): void => {
  const existing = images.get(nodeId);
  if (!existing) return;
  URL.revokeObjectURL(existing.url);
  existing.bitmap.close();
  images.delete(nodeId);
};
