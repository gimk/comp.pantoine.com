import React, { useRef, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { ImagePlus } from 'lucide-react';
import type { ImageNodeData } from '../state/graph';
import { useGraph } from '../state/store';

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

  const accept = (files: FileList | null) => {
    const file = files?.[0];
    if (file && file.type.startsWith('image/')) void loadImage(id, file);
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

      <button className="node-body image-drop nodrag" onClick={() => inputRef.current?.click()}>
        {data.src ? (
          <img className="image-thumb" src={data.src} alt={data.name} />
        ) : (
          /* A restored node remembers its filename but not its pixels, so it
             asks for that file back by name rather than looking like an
             empty node the user forgot to fill in. */
          <span className="image-empty">
            {data.name ? 'Re-import ' + data.name : 'Click or drop an image'}
          </span>
        )}
      </button>

      {data.src && (
        <div className="node-meta">
          <span className="node-meta-name">{data.name}</span>
          <span>
            {data.width} &times; {data.height}
          </span>
        </div>
      )}

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
