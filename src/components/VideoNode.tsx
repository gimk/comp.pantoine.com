import React, { useMemo, useRef, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Film, Video as VideoIcon } from 'lucide-react';
import { paramPort, type VideoNodeData } from '../state/graph';
import { useGraph } from '../state/store';
import { type ParamSpec } from '../engine/effects';
import { Toggle } from './controlPrimitives';
import { ParamRow } from './EffectNode';

const SPEED_SPEC: ParamSpec = {
  kind: 'float',
  key: 'speed',
  label: 'Speed',
  min: 0,
  max: 4,
  step: 0.05,
  default: 1,
};

const formatDuration = (sec: number): string => {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/**
 * The video source node. Empty until a video file lands on it, by click or by drop.
 *
 * Displays a still preview frame with on-hover playback preview, while the WebGL
 * pipeline reads from the decoded video stream.
 */
export const VideoNode: React.FC<NodeProps<Node<VideoNodeData, 'video'>>> = ({ id, data }) => {
  const loadVideo = useGraph((state) => state.loadVideo);
  const setVideoData = useGraph((state) => state.setVideoData);
  const edges = useGraph((state) => state.edges);
  const attachMathControls = useGraph((state) => state.attachMathControls);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = useState(false);

  const hasSpeedEdge = edges.some((e) => e.target === id && e.targetHandle === paramPort('speed'));
  const hasTimeEdge = edges.some((e) => e.target === id && e.targetHandle === paramPort('time'));

  const timeSpec = useMemo<ParamSpec>(
    () => ({
      kind: 'float',
      key: 'time',
      label: 'Time',
      min: 0,
      max: Math.max(1, data.duration || 60),
      step: 0.01,
      default: 0,
    }),
    [data.duration],
  );

  const accept = (files: FileList | null) => {
    const file = files?.[0];
    if (file && (file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(file.name))) {
      void loadVideo(id, file);
    }
  };

  return (
    <div
      className={'node node-image' + (isOver ? ' node-drop-active' : '')}
      onDragOver={(e) => {
        e.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        accept(e.dataTransfer.files);
      }}
    >
      <div className="node-title">
        <Film size={13} />
        <span>Video</span>
      </div>

      {data.error && (
        <div className="node-body node-warning" title={data.error}>
          {data.error}
        </div>
      )}

      <button
        className="node-body image-drop nodrag"
        onClick={() => inputRef.current?.click()}
        onMouseEnter={(e) => {
          const video = e.currentTarget.querySelector('video');
          if (video && video.paused) {
            void video.play().catch(() => {});
          }
        }}
        onMouseLeave={(e) => {
          const video = e.currentTarget.querySelector('video');
          if (video && !video.paused) {
            video.pause();
            video.currentTime = 0;
          }
        }}
      >
        {data.src ? (
          <video
            className="image-thumb"
            src={data.src}
            muted
            playsInline
            preload="auto"
          />
        ) : (
          <span className="image-empty">
            <VideoIcon size={18} />
            <span>Click or drop a video</span>
          </span>
        )}
      </button>

      {data.src && (
        <div className="node-meta">
          <span className="node-meta-name">{data.name}</span>
          <span>
            {data.width} &times; {data.height}
            {data.duration > 0 && ` (${formatDuration(data.duration)})`}
          </span>
        </div>
      )}

      <div className="node-body">
        <ParamRow
          nodeId={id}
          spec={SPEED_SPEC}
          value={data.speed ?? 1}
          port={true}
          onChange={(val) => setVideoData(id, { speed: val as number, playbackRate: val as number })}
        />
        <ParamRow
          nodeId={id}
          spec={timeSpec}
          value={data.time ?? 0}
          port={true}
          onChange={(val) => setVideoData(id, { time: val as number })}
        />
        <div style={{ paddingTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Toggle
            label="Loop"
            value={data.loop !== false}
            onChange={(loop) => setVideoData(id, { loop })}
          />
          {!hasSpeedEdge && !hasTimeEdge && (
            <button
              type="button"
              className="export-now-btn nodrag"
              onClick={() => attachMathControls(id)}
              title="Add 2 Math nodes to modulate speed and time"
            >
              Attach Math
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          accept(e.target.files);
          // Reset so picking the same file twice still fires a change.
          e.target.value = '';
        }}
      />

      <Handle type="source" position={Position.Right} className="port port-out" />
    </div>
  );
};
