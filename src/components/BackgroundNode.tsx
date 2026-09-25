import React, { useCallback } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Wallpaper } from 'lucide-react';
import { useGraph } from '../state/store';
import {
  findUpstreamRenderNode,
  resolveChain,
  type BackgroundNodeData,
} from '../state/graph';
import { getImage } from '../engine/imageStore';
import { isPlaying, subscribeClock } from '../engine/clock';
import { Slider } from './controlPrimitives';

export const BackgroundNode: React.FC<NodeProps<Node<BackgroundNodeData, 'backgroundOutput'>>> = ({
  id,
  data,
}) => {
  const nodes = useGraph((state) => state.nodes);
  const edges = useGraph((state) => state.edges);
  const setBackgroundData = useGraph((state) => state.setBackgroundData);
  const backgroundFps = useGraph((state) => state.backgroundFps);

  const upstreamRenderNode = findUpstreamRenderNode(nodes, edges, id);
  const isRenderMode = !!upstreamRenderNode;
  const renderAssetData = upstreamRenderNode?.data;
  const hasRenderedAsset = !!renderAssetData?.renderedBlob && !!renderAssetData?.renderedUrl;

  const chain = resolveChain(nodes, edges, id);
  const primaryImage = chain ? getImage(chain.sourceNodeId) : undefined;
  const isPlayingNow = React.useSyncExternalStore(subscribeClock, isPlaying);

  const isConnected = !!chain || (isRenderMode && hasRenderedAsset);
  const isEnabled = data.enabled !== false;

  const update = useCallback(
    (patch: Partial<BackgroundNodeData>) => {
      setBackgroundData(id, patch);
    },
    [id, setBackgroundData],
  );

  const toggleEnabled = useCallback(() => {
    update({ enabled: !isEnabled });
  }, [isEnabled, update]);

  // Dimension / Resolution info
  const infoText = isRenderMode
    ? renderAssetData?.renderedDimensions
      ? `${renderAssetData.renderedDimensions.width} × ${renderAssetData.renderedDimensions.height}`
      : renderAssetData
        ? renderAssetData.format.toUpperCase()
        : '—'
    : primaryImage
      ? `${primaryImage.width} × ${primaryImage.height}`
      : '—';

  return (
    <div className="node node-background">
      {/* Dual input handle: Live picture or Rendered asset */}
      <Handle
        type="target"
        position={Position.Left}
        className="port port-in port-title port-dual"
        title="Input (Live picture or Rendered asset)"
      />

      {/* Dual output handle: Pass-through */}
      <Handle
        type="source"
        position={Position.Right}
        className="port port-out port-title port-dual"
        title="Pass-through output (Live picture or Rendered asset)"
      />

      <div className="node-title">
        <Wallpaper size={13} style={{ color: 'var(--port-image)' }} />
        <span>Background</span>
        <span
          className="render-info"
          style={{ marginLeft: 'auto', textTransform: 'none', fontWeight: 400 }}
        >
          {infoText}
        </span>
      </div>

      <div className="node-body">
        {/* Active Toggle & Fit Mode */}
        <div className="control control-inline" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className={`bg-toggle-btn nodrag ${isEnabled ? 'is-active' : ''}`}
            onClick={toggleEnabled}
            title={isEnabled ? 'Click to disable background' : 'Click to enable background'}
          >
            <span className={`bg-toggle-dot ${isEnabled ? 'is-live' : ''}`} />
            <span>{isEnabled ? 'Enabled' : 'Disabled'}</span>
          </button>

          <div className="bg-segmented-control nodrag">
            <button
              type="button"
              className={`bg-seg-btn ${(data.fit ?? 'fill') === 'fill' ? 'is-active' : ''}`}
              onClick={() => update({ fit: 'fill' })}
              title="Scale to fill entire screen"
            >
              Fill
            </button>
            <button
              type="button"
              className={`bg-seg-btn ${data.fit === 'fit' ? 'is-active' : ''}`}
              onClick={() => update({ fit: 'fit' })}
              title="Scale to fit within screen"
            >
              Fit
            </button>
          </div>
        </div>

        {/* Opacity Slider */}
        <Slider
          label="Opacity"
          value={data.opacity ?? 1}
          defaultValue={1}
          min={0}
          max={1}
          step={0.01}
          onChange={(val) => update({ opacity: val })}
        />

        {/* Status card */}
        <div className={`export-recipe-card ${!isConnected || !isEnabled ? 'is-default' : ''}`}>
          <div
            className="export-recipe-tag"
            style={
              isEnabled && isConnected
                ? { background: isRenderMode ? 'var(--port-render)' : 'var(--port-image)' }
                : undefined
            }
          >
            {isEnabled
              ? isConnected
                ? isRenderMode
                  ? 'ASSET'
                  : 'LIVE BG'
                : 'NO INPUT'
              : 'OFF'}
          </div>
          <div className="export-recipe-desc">
            {!isEnabled ? (
              <span>Background render is disabled</span>
            ) : !isConnected ? (
              <span>Wire an image or effect in</span>
            ) : isRenderMode ? (
              <span>Full-screen rendered {renderAssetData?.format.toUpperCase()}</span>
            ) : (
              <span>
                Full-screen {(data.fit ?? 'fill') === 'fit' ? 'Fit' : 'Fill'} · {Math.round((data.opacity ?? 1) * 100)}%
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="render-foot">
        <span
          className={`render-dot ${isEnabled && isConnected ? 'is-live' : ''}`}
          style={
            isEnabled && isConnected && isRenderMode
              ? { background: 'var(--port-render)' }
              : undefined
          }
        />
        <span>
          {!isEnabled
            ? 'Disabled'
            : !isConnected
              ? 'Idle'
              : isRenderMode
                ? hasRenderedAsset
                  ? `Asset (${renderAssetData?.format.toUpperCase()})`
                  : 'Awaiting Render'
                : isPlayingNow
                  ? 'Playing'
                  : 'Live'}
        </span>
        {isEnabled && isConnected && !isRenderMode && backgroundFps !== null && (
          <span className="render-fps">{Math.round(backgroundFps)} fps</span>
        )}
        {isEnabled && chain && !isRenderMode && (
          <span className="render-chain">
            {chain.passes.length} effect{chain.passes.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  );
};
