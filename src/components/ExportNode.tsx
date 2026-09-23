import React, { useCallback } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Download, Loader2 } from 'lucide-react';
import { useGraph } from '../state/store';
import {
  RENDER_PORT,
  findUpstreamRenderNode,
  type ExportNodeData,
} from '../state/graph';
import { downloadBlob, getExportFilename } from '../engine/exportEngine';

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const ExportNode: React.FC<NodeProps<Node<ExportNodeData, 'export'>>> = ({ id, data }) => {
  const nodes = useGraph((state) => state.nodes);
  const edges = useGraph((state) => state.edges);
  const setExportData = useGraph((state) => state.setExportData);

  // Find upstream purple connection from a Render node (directly or through pass-through Viewers)
  const upstreamRenderNode = findUpstreamRenderNode(nodes, edges, id);

  const renderData = upstreamRenderNode?.data;
  const hasBakedAsset = !!renderData?.renderedBlob;
  const isConnected = !!upstreamRenderNode && !!renderData;

  const update = useCallback(
    (patch: Partial<ExportNodeData>) => {
      setExportData(id, patch);
    },
    [id, setExportData],
  );

  const handleDownload = useCallback(() => {
    if (!renderData?.renderedBlob) return;
    const baseName = data.filenamePrefix.trim() || 'comp';
    const filename = getExportFilename(baseName, renderData.format);
    downloadBlob(renderData.renderedBlob, filename);
  }, [data.filenamePrefix, renderData]);

  return (
    <div className="node node-export">
      {/* Purple input handle for rendered media asset */}
      <Handle
        type="target"
        position={Position.Left}
        id={RENDER_PORT}
        className="port port-in port-title port-render"
        title="Rendered file input (Purple)"
      />

      <div className="node-title">
        <Download size={13} style={{ color: 'var(--port-render)' }} />
        <span>Exporter</span>
        <span
          className="render-info"
          style={{ marginLeft: 'auto', textTransform: 'none', fontWeight: 400 }}
        >
          {hasBakedAsset && renderData?.renderedDimensions
            ? `${renderData.renderedDimensions.width} × ${renderData.renderedDimensions.height}`
            : isConnected && renderData
              ? renderData.format.toUpperCase()
              : '—'}
        </span>
      </div>

      <div className="node-body">
        {/* Connected asset summary card */}
        <div className={`export-recipe-card${!isConnected ? ' is-default' : ''}`}>
          <div
            className="export-recipe-tag"
            style={
              isConnected
                ? { background: 'var(--port-render)' }
                : undefined
            }
          >
            {isConnected && renderData ? renderData.format.toUpperCase() : 'NO INPUT'}
          </div>
          <div className="export-recipe-desc">
            {isConnected && renderData ? (
              hasBakedAsset ? (
                <>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    Ready to download
                  </span>
                  <span>
                    {renderData.renderedDimensions
                      ? `${renderData.renderedDimensions.width}×${renderData.renderedDimensions.height} · `
                      : ''}
                    {formatBytes(renderData.renderedSize ?? renderData.renderedBlob!.size)}
                  </span>
                </>
              ) : renderData.rendering ? (
                <span>Baking in Render node…</span>
              ) : (
                <span>Click Render in node</span>
              )
            ) : (
              <span>Connect a Render node</span>
            )}
          </div>
        </div>

        {/* Filename Prefix */}
        <div className="control control-inline">
          <span className="control-label">Prefix</span>
          <input
            className="control-field nodrag"
            type="text"
            placeholder="comp"
            value={data.filenamePrefix}
            onChange={(e) => update({ filenamePrefix: e.target.value })}
            disabled={!isConnected}
          />
        </div>

        {/* Instant Download Action Button */}
        <button
          type="button"
          className="export-action-btn nodrag"
          disabled={!hasBakedAsset}
          onClick={handleDownload}
          title={
            !isConnected || !renderData
              ? 'Connect a Render node to export'
              : !hasBakedAsset
                ? 'Render asset first in upstream node'
                : `Download ${renderData.format.toUpperCase()} file`
          }
        >
          {renderData?.rendering ? (
            <>
              <Loader2 size={13} className="spin" />
              <span>Baking…</span>
            </>
          ) : (
            <>
              <Download size={13} />
              <span>Download {isConnected && renderData ? renderData.format.toUpperCase() : 'File'}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
