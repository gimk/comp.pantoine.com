import React, { useSyncExternalStore } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { SlidersHorizontal, Waves, Sparkles } from 'lucide-react';
import { type GeneratorNodeData } from '../state/graph';
import { getGenerator, RESOLUTION_PRESETS } from '../engine/generators';
import { getEffect } from '../engine/registry';
import { paramsOf } from '../engine/effects';
import { isModulatable } from '../engine/modulators';
import { useGraph } from '../state/store';
import { getShaderError, subscribeShaderErrors } from '../engine/shaderErrors';
import { ParamRow } from './EffectNode';
import { GradientEditor } from './GradientEditor';

const GENERATOR_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  ramp: SlidersHorizontal,
  noise: Waves,
};

/**
 * First-class generated media input node, producing procedural media from scratch
 * (similar to TouchDesigner Ramp TOP and Noise TOP).
 */
export const GeneratorNode: React.FC<NodeProps<Node<GeneratorNodeData, 'generator'>>> = ({ id, data }) => {
  const setParam = useGraph((state) => state.setParam);
  const setGeneratorResolution = useGraph((state) => state.setGeneratorResolution);
  const def = getGenerator(data.generatorId) ?? getEffect(data.generatorId);

  const shaderError = useSyncExternalStore(
    subscribeShaderErrors,
    () => getShaderError(data.generatorId),
  );

  if (!def) {
    return (
      <div className="node node-effect">
        <div className="node-title">
          <span>Unknown generator</span>
        </div>
        <div className="node-body node-warning">{data.generatorId}</div>
        <Handle type="source" position={Position.Right} className="port port-out port-title" />
      </div>
    );
  }

  const Icon = GENERATOR_ICONS[data.generatorId] ?? Sparkles;
  const currentWidth = data.width || 1280;
  const currentHeight = data.height || 720;
  const currentResKey = `${currentWidth}x${currentHeight}`;
  const isRamp = data.generatorId === 'ramp';

  const handleResolutionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const [w, h] = val.split('x').map(Number);
    if (w && h) {
      setGeneratorResolution(id, w, h);
    }
  };

  return (
    <div className={`node node-effect ${isRamp ? 'node-ramp' : ''}`}>
      <div className="node-title">
        <Icon size={13} />
        <span>{def.label}</span>
      </div>

      {shaderError && (
        <div className="node-body node-warning" title={shaderError}>
          Shader error — see console.
        </div>
      )}

      <div className="node-body">
        {/* Resolution selector */}
        <div className="control-row">
          <div className="control-label-line">
            <span className="control-label">Resolution</span>
            <span className="control-value">{currentWidth}&times;{currentHeight}</span>
          </div>
          <select
            className="control-select nodrag"
            aria-label="Resolution"
            value={currentResKey}
            onChange={handleResolutionChange}
          >
            {RESOLUTION_PRESETS.map((preset) => {
              const key = `${preset.width}x${preset.height}`;
              return (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              );
            })}
          </select>
        </div>

        {/* Specialized Design-Tool Gradient Editor for Ramp */}
        {isRamp && (
          <GradientEditor nodeId={id} params={data.params} setParam={setParam} />
        )}

        {/* Generator parameters (filtered for Ramp to avoid redundant stop rows) */}
        {paramsOf(def)
          .filter((spec) => (isRamp ? ['type', 'angle', 'interpolation', 'extend'].includes(spec.key) : true))
          .map((spec) => (
            <ParamRow
              key={spec.key}
              nodeId={id}
              spec={spec}
              value={data.params[spec.key]}
              port={isModulatable(spec)}
              onChange={(value) => setParam(id, spec.key, value)}
            />
          ))}
      </div>

      <Handle type="source" position={Position.Right} className="port port-out port-title" />
    </div>
  );
};
