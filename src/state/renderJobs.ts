import { create } from 'zustand';

/*
 * What a Render node has baked, kept apart from the document.
 *
 * A render's blob, its object URL and its progress are session state, not
 * part of the graph: they must not be saved, snapshotted by undo, or copied
 * along with a duplicated node. Keeping them here, keyed by node id, means
 * the history and the clipboard never see them, and each URL has exactly one
 * owner that revokes it.
 */

export type RenderProgress = { currentFrame: number; totalFrames: number; percent: number };

export type RenderAsset = {
  blob: Blob;
  url: string;
  /** The format asked for when the render started. */
  requested: string;
  /** The container actually produced, which can differ from the one asked for. */
  extension: string;
  width: number;
  height: number;
};

export type RenderJob = {
  /** Present while a render runs; bumped on each start so a stale job can tell it lost. */
  token: number | null;
  progress: RenderProgress | null;
  asset: RenderAsset | null;
  error: string | null;
};

type RenderJobsState = {
  jobs: Record<string, RenderJob>;
  /** Starts a job and returns its token, aborting any job already running on the node. */
  start: (nodeId: string, controller: AbortController) => number;
  /** Progress from a job; ignored unless `token` is still the node's current one. */
  progress: (nodeId: string, token: number, progress: RenderProgress) => void;
  /** Result of a job; ignored (and the blob dropped) unless `token` is current. */
  finish: (nodeId: string, token: number, asset: Omit<RenderAsset, 'url'>) => void;
  fail: (nodeId: string, token: number, error: string | null) => void;
  /** Aborts the running job, if any, and marks the node idle straight away. */
  cancel: (nodeId: string) => void;
  /** Aborts and forgets everything about a node, revoking its URL. */
  clear: (nodeId: string) => void;
};

const EMPTY: RenderJob = { token: null, progress: null, asset: null, error: null };

let tokenCounter = 0;
const controllers = new Map<string, AbortController>();

const patch = (
  jobs: Record<string, RenderJob>,
  nodeId: string,
  change: Partial<RenderJob>,
): Record<string, RenderJob> => ({ ...jobs, [nodeId]: { ...(jobs[nodeId] ?? EMPTY), ...change } });

export const useRenderJobs = create<RenderJobsState>((set, get) => ({
  jobs: {},

  start: (nodeId, controller) => {
    controllers.get(nodeId)?.abort();
    controllers.set(nodeId, controller);
    tokenCounter += 1;
    const token = tokenCounter;
    set((state) => ({
      jobs: patch(state.jobs, nodeId, {
        token,
        error: null,
        progress: { currentFrame: 0, totalFrames: 1, percent: 0 },
      }),
    }));
    return token;
  },

  progress: (nodeId, token, progress) => {
    if (get().jobs[nodeId]?.token !== token) return;
    set((state) => ({ jobs: patch(state.jobs, nodeId, { progress }) }));
  },

  finish: (nodeId, token, asset) => {
    if (get().jobs[nodeId]?.token !== token) return;
    controllers.delete(nodeId);
    const previous = get().jobs[nodeId]?.asset;
    // Viewers keep the old <video>/<img> mounted until they re-render with the
    // new URL, so the old one is revoked a moment later rather than under them.
    if (previous) setTimeout(() => URL.revokeObjectURL(previous.url), 2000);
    const url = URL.createObjectURL(asset.blob);
    set((state) => ({
      jobs: patch(state.jobs, nodeId, {
        token: null,
        progress: null,
        error: null,
        asset: { ...asset, url },
      }),
    }));
  },

  fail: (nodeId, token, error) => {
    if (get().jobs[nodeId]?.token !== token) return;
    controllers.delete(nodeId);
    set((state) => ({ jobs: patch(state.jobs, nodeId, { token: null, progress: null, error }) }));
  },

  cancel: (nodeId) => {
    controllers.get(nodeId)?.abort();
    controllers.delete(nodeId);
    if (!get().jobs[nodeId]) return;
    set((state) => ({ jobs: patch(state.jobs, nodeId, { token: null, progress: null }) }));
  },

  clear: (nodeId) => {
    controllers.get(nodeId)?.abort();
    controllers.delete(nodeId);
    const job = get().jobs[nodeId];
    if (!job) return;
    if (job.asset) URL.revokeObjectURL(job.asset.url);
    set((state) => {
      const { [nodeId]: _gone, ...rest } = state.jobs;
      return { jobs: rest };
    });
  },
}));

/** The job for one node; re-renders only when that node's job changes. */
export const useRenderJob = (nodeId: string | null | undefined): RenderJob =>
  useRenderJobs((state) => (nodeId ? state.jobs[nodeId] : undefined) ?? EMPTY);

export const isRendering = (job: RenderJob): boolean => job.token !== null;
