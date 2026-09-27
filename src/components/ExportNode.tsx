import React, { useCallback } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Download, Loader2 } from 'lucide-react';
import { useGraph } from '../state/store';
import { RENDER_PORT, type ExportNodeData } from '../state/graph';
import { isRendering } from '../state/renderJobs';
import { downloadBlob, getExportFilename } from '../engine/exportEngine';
import { useUpstreamRender } from './viewerPipeline';
import { formatBytes, formatLabel } from './format';

export const ExportNode: React.FC<NodeProps<Node<ExportNodeData, 'export'>>> = ({ id, data }) => {
  const setExportData = useGraph((state) => state.setExportData);

  // The Render node upstream along purple wires (directly or through pass-through Viewers).
  const { renderId, settings, job } = useUpstreamRender(id);
  const isConnected = !!renderId && !!settings;
  const asset = job.asset;
  const rendering = isRendering(job);
  // A finished file is named by what it is, not what was asked for: an MP4
  // request can come back as WebM. While a bake runs, by what is coming.
  const label =
    asset && !rendering ? formatLabel(asset.extension) : settings ? formatLabel(settings.format) : null;

  const update = useCallback(
    (patch: Partial<ExportNodeData>) => {
      setExportData(id, patch);
    },
    [id, setExportData],
  );

  const handleDownload = useCallback(() => {
    if (!asset || !settings) return;
    const baseName = data.filenamePrefix.trim() || 'comp';
    downloadBlob(asset.blob, getExportFilename(baseName, settings.format, asset.extension));
  }, [asset, data.filenamePrefix, settings]);

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
          {isConnected && asset ? `${asset.width} × ${asset.height}` : isConnected ? label : '—'}
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
            {isConnected ? label : 'NO INPUT'}
          </div>
          <div className="export-recipe-desc">
            {isConnected ? (
              rendering ? (
                <span>Baking in Render node…</span>
              ) : asset ? (
                <>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    Ready to download
                  </span>
                  <span>
                    {asset.width}×{asset.height} · {formatBytes(asset.blob.size)}
                  </span>
                </>
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

        {/* Held back while a new bake runs, so what is downloaded is never
            the file the Render node is in the middle of replacing. */}
        <button
          type="button"
          className="export-action-btn nodrag"
          disabled={!isConnected || !asset || rendering}
          onClick={handleDownload}
          title={
            !isConnected
              ? 'Connect a Render node to export'
              : rendering
                ? 'Rendering in progress…'
                : !asset
                  ? 'Render asset first in upstream node'
                  : `Download ${label} file`
          }
        >
          {rendering ? (
            <>
              <Loader2 size={13} className="spin" />
              <span>Baking…</span>
            </>
          ) : (
            <>
              <Download size={13} />
              <span>Download {isConnected ? label : 'File'}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
