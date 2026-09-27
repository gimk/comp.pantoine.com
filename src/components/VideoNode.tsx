import React, { useRef, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Film, Video as VideoIcon } from 'lucide-react';
import type { VideoNodeData } from '../state/graph';
import { useGraph } from '../state/store';
import { Toggle } from './controlPrimitives';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = useState(false);

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
        <>
          <div className="node-meta">
            <span className="node-meta-name">{data.name}</span>
            <span>
              {data.width} &times; {data.height}
              {data.duration > 0 && ` (${formatDuration(data.duration)})`}
            </span>
          </div>
          <div style={{ padding: '0 12px 10px' }}>
            <Toggle
              label="Loop"
              value={data.loop !== false}
              onChange={(loop) => setVideoData(id, { loop })}
            />
          </div>
        </>
      )}

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
