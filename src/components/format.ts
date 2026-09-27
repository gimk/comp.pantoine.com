/** A file size as someone would say it: bytes, then KB, then MB. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Whether a baked file plays rather than sits still.
 *
 * Decided from the extension actually produced, not the format asked for:
 * an MP4 request can come back as WebM, and a GIF is shown as an image.
 */
export const isMotionExtension = (extension: string): boolean =>
  extension === 'mp4' || extension === 'webm';

/** How a container is named on a label or tag. */
export const formatLabel = (extension: string): string => extension.toUpperCase();
