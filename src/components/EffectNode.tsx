import React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Sparkles } from 'lucide-react';
import type { EffectNodeData } from '../state/graph';
import { getEffect } from '../engine/registry';
import { useGraph } from '../state/store';
import { Slider } from './controlPrimitives';

/**
 * One component for every effect there will ever be.
 *
 * The card is generated from the effect's `EffectDef`: its title from the
 * label, its controls from the param specs. That is the whole reason adding
 * an effect touches no UI code.
 */
export const EffectNode: React.FC<NodeProps<Node<EffectNodeData, 'effect'>>> = ({ id, data }) => {
  const setParam = useGraph((state) => state.setParam);
  const def = getEffect(data.effectId);

  if (!def) {
    return (
      <div className="node node-effect">
        <div className="node-title">
          <span>Unknown effect</span>
        </div>
        <div className="node-body node-warning">{data.effectId}</div>
        <Handle type="target" position={Position.Left} className="port port-in" />
        <Handle type="source" position={Position.Right} className="port port-out" />
      </div>
    );
  }

  return (
    <div className="node node-effect">
      <div className="node-title">
        <Sparkles size={13} />
        <span>{def.label}</span>
      </div>

      <div className="node-body">
        {def.params.map((spec) => (
          <Slider
            key={spec.key}
            label={spec.label}
            value={data.params[spec.key] ?? spec.default}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            onChange={(value) => setParam(id, spec.key, value)}
          />
        ))}
      </div>

      <Handle type="target" position={Position.Left} className="port port-in" />
      <Handle type="source" position={Position.Right} className="port port-out" />
    </div>
  );
};
