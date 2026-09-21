import React from 'react';
import { Handle, Position, useNodeConnections } from '@xyflow/react';
import { MonitorPlay } from 'lucide-react';

/**
 * The sink the render view reads from.
 *
 * It holds no settings; its whole job is to be the one place in the graph
 * that answers "what am I looking at". The card reports whether it is
 * actually fed, because an unconnected output and a broken chain look
 * identical from the render view's empty state.
 */
export const OutputNode: React.FC = () => {
  const connections = useNodeConnections({ handleType: 'target' });
  const isConnected = connections.length > 0;

  return (
    <div className="node node-output">
      <div className="node-title">
        <MonitorPlay size={13} />
        <span>Output</span>
      </div>
      <div className="node-body">
        <span className={'output-status' + (isConnected ? ' is-live' : '')}>
          {isConnected ? 'Live' : 'Not connected'}
        </span>
      </div>
      <Handle type="target" position={Position.Left} className="port port-in" />
    </div>
  );
};
