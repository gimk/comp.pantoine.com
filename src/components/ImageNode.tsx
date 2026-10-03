import React, { useRef, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { ImagePlus, ImageUp } from 'lucide-react';
import type { ImageNodeData } from '../state/graph';
import { useGraph } from '../state/store';
import { SourceMeta } from './sourceMeta';
import { mediaKindOf } from './paletteDrag';

/**
 * The source node. Empty until an image lands on it, by click or by drop.
 *
 * The thumbnail is a plain object URL rather than anything GPU-side -- the
 * texture the renderer uses is uploaded separately from the decoded bitmap,
 * so the card can redraw as often as React likes without touching WebGL.
 */
export const ImageNode: React.FC<NodeProps<Node<ImageNodeData, 'image'>>> = ({ id, data }) => {
  const loadImage = useGraph((state) => state.loadImage);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = useState(false);
  /* A dropped file that isn't an image never reaches the store; keyed to the
     src it was raised against, so a new picture clears it. */
  const [localError, setLocalError] = useState<{ src: string | null; message: string } | null>(null);
  const shownError = data.error ?? (localError && localError.src === data.src ? localError.message : undefined);

  const accept = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (mediaKindOf(file) === 'image') {
      setLocalError(null);
      void loadImage(id, file);
    } else {
      setLocalError({ src: data.src, message: `${file.name} is not an image file.` });
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
        <ImagePlus size={13} />
        <span>Image</span>
      </div>

      {shownError && (
        <div className="node-body node-warning" title={shownError} role="alert">
          {shownError}
        </div>
      )}

      <button
        type="button"
        className={'node-body image-drop nodrag' + (data.src ? ' has-media' : '')}
        aria-label={data.src ? `Replace image ${data.name}` : undefined}
        onClick={() => inputRef.current?.click()}
      >
        {data.src ? (
          <span className="image-frame">
            <img className="image-thumb" src={data.src} alt={data.name} />
          </span>
        ) : (
          <span className="image-empty">
            <ImageUp size={18} />
            <span>Click or drop an image</span>
          </span>
        )}
      </button>

      {data.src && <SourceMeta name={data.name} width={data.width} height={data.height} />}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
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
