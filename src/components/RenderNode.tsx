import React, { useCallback, useEffect, useRef } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { CheckCircle2, Film, Loader2, X } from 'lucide-react';
import { useGraph } from '../state/store';
import {
  RENDER_PORT,
  resolveChain,
  type ExportFormat,
  type RenderNodeData,
} from '../state/graph';
import { getImage } from '../engine/imageStore';
import { clockSeconds } from '../engine/clock';
import { NumberField, Slider } from './controlPrimitives';
import {
  exportGif,
  exportStill,
  exportVideo,
} from '../engine/exportEngine';

const FORMATS: { format: ExportFormat; label: string; isMotion: boolean }[] = [
  { format: 'mp4', label: 'MP4', isMotion: true },
  { format: 'webm', label: 'WEBM', isMotion: true },
  { format: 'gif', label: 'GIF', isMotion: true },
  { format: 'png', label: 'PNG', isMotion: false },
  { format: 'jpg', label: 'JPG', isMotion: false },
];

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const RenderNode: React.FC<NodeProps<Node<RenderNodeData, 'render'>>> = ({
  id,
  data,
}) => {
  const nodes = useGraph((state) => state.nodes);
  const edges = useGraph((state) => state.edges);
  const setRenderData = useGraph((state) => state.setRenderData);

  const chain = resolveChain(nodes, edges, id);
  const primaryImage = chain ? getImage(chain.sourceNodeId) : undefined;

  const abortControllerRef = useRef<AbortController | null>(null);

  const update = useCallback(
    (patch: Partial<RenderNodeData>) => {
      setRenderData(id, patch);
    },
    [id, setRenderData],
  );

  const useCurrentTime = useCallback(() => {
    update({ time: Math.round(clockSeconds() * 100) / 100 });
  }, [update]);

  const outputWidth = primaryImage ? Math.max(1, Math.round(primaryImage.width * data.scale)) : 0;
  const outputHeight = primaryImage ? Math.max(1, Math.round(primaryImage.height * data.scale)) : 0;

  const cancelRender = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    update({
      rendering: false,
      progress: null,
    });
  }, [update]);

  const handleRender = useCallback(async () => {
    if (!chain || !primaryImage || data.rendering) return;

    // Revoke old URL if existing to free memory
    if (data.renderedUrl) {
      URL.revokeObjectURL(data.renderedUrl);
    }

    update({
      rendering: true,
      error: null,
      progress: { currentFrame: 0, totalFrames: 1, percent: 0 },
    });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      let result: { blob: Blob; extension: string };

      if (data.format === 'jpg' || data.format === 'png') {
        result = await exportStill({ chain, data });
      } else if (data.format === 'gif') {
        result = await exportGif({
          chain,
          data,
          signal: controller.signal,
          onProgress: (progress) => update({ progress }),
        });
      } else {
        result = await exportVideo({
          chain,
          data,
          signal: controller.signal,
          onProgress: (progress) => update({ progress }),
        });
      }

      const url = URL.createObjectURL(result.blob);
      update({
        renderedBlob: result.blob,
        renderedUrl: url,
        renderedSize: result.blob.size,
        renderedDimensions: { width: outputWidth, height: outputHeight },
        rendering: false,
        progress: null,
        error: null,
      });
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        update({ rendering: false, progress: null });
        return;
      }
      const message = err instanceof Error ? err.message : 'Render failed';
      update({
        rendering: false,
        progress: null,
        error: message,
      });
    } finally {
      abortControllerRef.current = null;
    }
  }, [chain, data, id, outputHeight, outputWidth, primaryImage, update]);

  // Clean up object URL on unmount
  useEffect(() => {
    return () => {
      if (data.renderedUrl) {
        URL.revokeObjectURL(data.renderedUrl);
      }
    };
  }, []);

  const hasRendered = !!data.renderedBlob && !!data.renderedUrl;

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
          {primaryImage ? `${outputWidth} × ${outputHeight}` : '—'}
        </span>
      </div>

      <div className="node-body">
        {/* Format tabs */}
        <div className="export-formats nodrag" role="tablist" aria-label="Render format">
          {FORMATS.map(({ format, label }) => (
            <button
              key={format}
              type="button"
              className={`export-format-btn${data.format === format ? ' is-active' : ''}`}
              onClick={() => update({ format })}
              disabled={data.rendering}
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
            </div>
            <Slider
              label="Length (s)"
              value={data.duration}
              defaultValue={2}
              min={0.2}
              max={10}
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
            </div>
            <Slider
              label="Length (s)"
              value={data.duration}
              defaultValue={3}
              min={0.5}
              max={30}
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

        {/* Baked status badge */}
        {hasRendered && !data.rendering && (
          <div className="render-badge-baked">
            <CheckCircle2 size={12} />
            <span>
              Baked {data.renderedDimensions ? `${data.renderedDimensions.width}×${data.renderedDimensions.height}` : ''}
              {data.renderedSize ? ` · ${formatBytes(data.renderedSize)}` : ''}
            </span>
          </div>
        )}

        {/* Error message */}
        {data.error && <div className="export-error">{data.error}</div>}

        {/* Progress indicator during baking */}
        {data.rendering && data.progress && (
          <div className="export-progress">
            <div className="export-progress-track">
              <div
                className="export-progress-bar"
                style={{
                  width: `${data.progress.percent}%`,
                  background: 'var(--port-render)',
                }}
              />
            </div>
            <div className="export-progress-status">
              <span>
                {data.progress.totalFrames > 1
                  ? `${data.progress.currentFrame} / ${data.progress.totalFrames} (${data.progress.percent}%)`
                  : 'Baking…'}
              </span>
              <button
                type="button"
                className="export-cancel-btn nodrag"
                onClick={cancelRender}
                title="Cancel render"
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
          disabled={!chain || !primaryImage || data.rendering}
          title={
            !chain || !primaryImage
              ? 'Connect an image chain to render'
              : data.rendering
                ? 'Rendering in progress…'
                : 'Bake media file asset'
          }
        >
          {data.rendering ? (
            <>
              <Loader2 size={13} className="spin" />
              <span>Rendering…</span>
            </>
          ) : (
            <>
              <Film size={13} />
              <span>{hasRendered ? `Re-render ${data.format.toUpperCase()}` : `Render ${data.format.toUpperCase()}`}</span>
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
