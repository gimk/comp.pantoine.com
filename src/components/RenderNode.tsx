import React, { useCallback } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { CheckCircle2, Film, Loader2, X } from 'lucide-react';
import { useGraph } from '../state/store';
import {
  RENDER_PORT,
  generatorsForPlan,
  resolveChain,
  type ExportFormat,
  type RenderNodeData,
} from '../state/graph';
import { isRendering, useRenderJob, useRenderJobs } from '../state/renderJobs';
import { getImage } from '../engine/imageStore';
import { getVideo } from '../engine/videoStore';
import { clockSeconds } from '../engine/clock';
import { NumberField, Slider } from './controlPrimitives';
import { exportGif, exportStill, exportVideo } from '../engine/exportEngine';
import { useResolvedChain } from './viewerPipeline';
import { formatBytes, formatLabel } from './format';

const FORMATS: { format: ExportFormat; label: string; isMotion: boolean }[] = [
  { format: 'mp4', label: 'MP4', isMotion: true },
  { format: 'webm', label: 'WEBM', isMotion: true },
  { format: 'gif', label: 'GIF', isMotion: true },
  { format: 'png', label: 'PNG', isMotion: false },
  { format: 'jpg', label: 'JPG', isMotion: false },
];

/**
 * Bakes the chain feeding it into a file.
 *
 * The file itself is not in the node's data but in the render-job store,
 * keyed by this node's id: it is session state, and keeping it out of the
 * document keeps it out of undo, saves and copies. Each render takes a
 * token from that store and reports under it, so a render that was
 * cancelled, or overtaken by a newer one, can finish however it likes
 * without touching what the node shows. The previous file stays up in
 * every viewer until the new one lands.
 */
export const RenderNode: React.FC<NodeProps<Node<RenderNodeData, 'render'>>> = ({
  id,
  data,
}) => {
  const setRenderData = useGraph((state) => state.setRenderData);
  const job = useRenderJob(id);
  const rendering = isRendering(job);
  const asset = job.asset;
  const progress = job.progress;

  const { chain } = useResolvedChain(id);
  const primaryVideo = chain ? getVideo(chain.sourceNodeId) : undefined;
  const primaryGenerator = chain ? generatorsForPlan(chain.plan).get(chain.sourceNodeId) : undefined;
  const primarySource = chain ? getImage(chain.sourceNodeId) ?? primaryVideo ?? primaryGenerator : undefined;

  const update = useCallback(
    (patch: Partial<RenderNodeData>) => {
      setRenderData(id, patch);
    },
    [id, setRenderData],
  );

  const useCurrentTime = useCallback(() => {
    update({ time: Math.round(clockSeconds() * 100) / 100 });
  }, [update]);

  const useFullVideo = useCallback(() => {
    if (primaryVideo && primaryVideo.duration > 0) {
      update({ time: 0, duration: Math.round(primaryVideo.duration * 100) / 100 });
    }
  }, [primaryVideo, update]);

  const outputWidth = primarySource ? Math.max(1, Math.round(primarySource.width * data.scale)) : 0;
  const outputHeight = primarySource ? Math.max(1, Math.round(primarySource.height * data.scale)) : 0;

  const cancelRender = useCallback(() => {
    useRenderJobs.getState().cancel(id);
  }, [id]);

  const handleRender = useCallback(async () => {
    // Read fresh at the click rather than closed over from the last render,
    // so the settings baked are the ones on screen.
    const { nodes, edges } = useGraph.getState();
    const node = nodes.find((n) => n.id === id);
    const renderChain = resolveChain(nodes, edges, id);
    if (node?.type !== 'render' || !renderChain) return;
    const settings = node.data;

    const controller = new AbortController();
    const jobs = useRenderJobs.getState();
    const token = jobs.start(id, controller);
    const request = {
      chain: renderChain,
      data: settings,
      signal: controller.signal,
      onProgress: (next: { currentFrame: number; totalFrames: number; percent: number }) =>
        useRenderJobs.getState().progress(id, token, next),
    };

    try {
      const result =
        settings.format === 'jpg' || settings.format === 'png'
          ? await exportStill(request)
          : settings.format === 'gif'
            ? await exportGif(request)
            : await exportVideo(request);
      // Both of these are no-ops unless this is still the node's current
      // job, so a cancelled or superseded render drops its result here.
      if (controller.signal.aborted) return;
      useRenderJobs.getState().finish(id, token, {
        blob: result.blob,
        requested: settings.format,
        extension: result.extension,
        width: result.width,
        height: result.height,
      });
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      useRenderJobs.getState().fail(id, token, err instanceof Error ? err.message : 'Render failed');
    }
  }, [id]);

  return (
    <div className="node node-render">
      {/* Blue picture input from upstream WebGL chain */}
      <Handle
        type="target"
        position={Position.Left}
        className="port port-in port-title"
        title="Live picture input (WebGL)"
      />

      <div className="node-title">
        <Film size={13} style={{ color: 'var(--port-render)' }} />
        <span>Render</span>
        <span
          className="render-info"
          style={{ marginLeft: 'auto', textTransform: 'none', fontWeight: 400 }}
        >
          {primarySource ? `${outputWidth} × ${outputHeight}` : '—'}
        </span>
      </div>

      <div className="node-body">
        {/* Format tabs */}
        <div className="export-formats nodrag" role="tablist" aria-label="Render format">
          {FORMATS.map(({ format, label }) => (
            <button
              key={format}
              type="button"
              role="tab"
              aria-selected={data.format === format}
              className={`export-format-btn${data.format === format ? ' is-active' : ''}`}
              onClick={() => update({ format })}
              disabled={rendering}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Resolution Scale */}
        <Slider
          label="Scale"
          value={data.scale}
          defaultValue={1}
          min={0.1}
          max={2}
          step={0.05}
          onChange={(val) => update({ scale: val })}
        />

        {/* Format-specific controls */}
        {data.format === 'jpg' && (
          <Slider
            label="Quality"
            value={data.quality}
            defaultValue={0.92}
            min={0.1}
            max={1}
            step={0.02}
            onChange={(val) => update({ quality: val })}
          />
        )}

        {(data.format === 'jpg' || data.format === 'png') && (
          <div className="export-time-row">
            <NumberField
              label="Time (s)"
              value={data.time}
              step={0.1}
              onChange={(val) => update({ time: Math.max(0, val) })}
            />
            <button
              type="button"
              className="export-now-btn nodrag"
              onClick={useCurrentTime}
              title="Set to current timeline playback time"
            >
              Current
            </button>
          </div>
        )}

        {data.format === 'gif' && (
          <>
            <Slider
              label="Colors"
              value={data.quality}
              defaultValue={0.9}
              min={0.1}
              max={1}
              step={0.05}
              onChange={(val) => update({ quality: val })}
            />
            <div className="export-time-row">
              <NumberField
                label="Start (s)"
                value={data.time}
                step={0.1}
                onChange={(val) => update({ time: Math.max(0, val) })}
              />
              <button
                type="button"
                className="export-now-btn nodrag"
                onClick={useCurrentTime}
                title="Set to current timeline playback time"
              >
                Current
              </button>
              {primaryVideo && (
                <button
                  type="button"
                  className="export-now-btn nodrag"
                  onClick={useFullVideo}
                  title="Match full duration of upstream video"
                >
                  Full
                </button>
              )}
            </div>
            <Slider
              label="Length (s)"
              value={data.duration}
              defaultValue={2}
              min={0.2}
              max={Math.max(10, primaryVideo?.duration ? Math.min(30, Math.ceil(primaryVideo.duration)) : 10)}
              step={0.2}
              onChange={(val) => update({ duration: val })}
            />
            <Slider
              label="FPS"
              value={data.fps}
              defaultValue={15}
              min={5}
              max={30}
              step={1}
              onChange={(val) => update({ fps: val })}
            />
          </>
        )}

        {(data.format === 'mp4' || data.format === 'webm') && (
          <>
            <Slider
              label="Bitrate"
              value={data.quality}
              defaultValue={0.9}
              min={0.1}
              max={1}
              step={0.05}
              onChange={(val) => update({ quality: val })}
            />
            <div className="export-time-row">
              <NumberField
                label="Start (s)"
                value={data.time}
                step={0.1}
                onChange={(val) => update({ time: Math.max(0, val) })}
              />
              <button
                type="button"
                className="export-now-btn nodrag"
                onClick={useCurrentTime}
                title="Set to current timeline playback time"
              >
                Current
              </button>
              {primaryVideo && (
                <button
                  type="button"
                  className="export-now-btn nodrag"
                  onClick={useFullVideo}
                  title="Match full duration of upstream video"
                >
                  Full
                </button>
              )}
            </div>
            <Slider
              label="Length (s)"
              value={data.duration}
              defaultValue={3}
              min={0.5}
              max={Math.max(30, primaryVideo?.duration ? Math.ceil(primaryVideo.duration) : 30)}
              step={0.5}
              onChange={(val) => update({ duration: val })}
            />
            <Slider
              label="FPS"
              value={data.fps}
              defaultValue={30}
              min={12}
              max={60}
              step={1}
              onChange={(val) => update({ fps: val })}
            />
          </>
        )}

        {/* Baked status badge. Named by the container actually produced:
            an MP4 request comes back as WebM where MP4 cannot be recorded. */}
        {asset && !rendering && (
          <div
            className="render-badge-baked"
            title={
              asset.extension !== asset.requested
                ? `${formatLabel(asset.requested)} is not supported here; baked as ${formatLabel(asset.extension)}`
                : undefined
            }
          >
            <CheckCircle2 size={12} />
            <span>
              Baked {formatLabel(asset.extension)} {asset.width}×{asset.height} · {formatBytes(asset.blob.size)}
            </span>
          </div>
        )}

        {/* Error message */}
        {job.error && <div className="export-error">{job.error}</div>}

        {/* Progress indicator during baking */}
        {rendering && progress && (
          <div className="export-progress">
            <div className="export-progress-track">
              <div
                className="export-progress-bar"
                style={{
                  width: `${progress.percent}%`,
                  background: 'var(--port-render)',
                }}
              />
            </div>
            <div className="export-progress-status">
              <span>
                {progress.totalFrames > 1
                  ? `${progress.currentFrame} / ${progress.totalFrames} (${progress.percent}%)`
                  : 'Baking…'}
              </span>
              <button
                type="button"
                className="export-cancel-btn nodrag"
                onClick={cancelRender}
                title="Cancel render"
                aria-label="Cancel render"
              >
                <X size={10} />
              </button>
            </div>
          </div>
        )}

        {/* Render action trigger button */}
        <button
          type="button"
          className="render-action-btn nodrag"
          onClick={handleRender}
          disabled={!chain || !primarySource || rendering}
          title={
            !chain || !primarySource
              ? 'Connect an image or video chain to render'
              : rendering
                ? 'Rendering in progress…'
                : 'Bake media file asset'
          }
        >
          {rendering ? (
            <>
              <Loader2 size={13} className="spin" />
              <span>Rendering…</span>
            </>
          ) : (
            <>
              <Film size={13} />
              <span>{asset ? `Re-render ${formatLabel(data.format)}` : `Render ${formatLabel(data.format)}`}</span>
            </>
          )}
        </button>
      </div>

      {/* Purple rendered media asset output handle (near top, level with title) */}
      <Handle
        type="source"
        position={Position.Right}
        id={RENDER_PORT}
        className="port port-out port-title port-render"
        title="Rendered file output (Purple)"
      />
    </div>
  );
};
