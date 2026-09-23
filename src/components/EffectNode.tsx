import React, { useSyncExternalStore } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Sparkles } from 'lucide-react';
import type { EffectNodeData } from '../state/graph';
import { getEffect } from '../engine/registry';
import { paramsOf, type ParamSpec, type ParamValue, type Rgb, type Vec2 } from '../engine/effects';
import { useGraph } from '../state/store';
import { getShaderError, subscribeShaderErrors } from '../engine/shaderErrors';
import { ColorField, Select, Slider, Toggle, Vec2Field } from './controlPrimitives';

/**
 * One control, picked from the param's kind.
 *
 * Split out so the node body stays a map over specs: the only thing that
 * ever needs touching when a new param kind is added is this switch.
 */
const Control: React.FC<{
  spec: ParamSpec;
  value: ParamValue | undefined;
  onChange: (value: ParamValue) => void;
}> = ({ spec, value, onChange }) => {
  switch (spec.kind) {
    case 'float':
      return (
        <Slider
          label={spec.label}
          value={(value as number) ?? spec.default}
          defaultValue={spec.default}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          onChange={onChange}
        />
      );
    case 'int':
      return (
        <Slider
          label={spec.label}
          value={(value as number) ?? spec.default}
          defaultValue={spec.default}
          min={spec.min}
          max={spec.max}
          step={1}
          onChange={onChange}
        />
      );
    case 'bool':
      return (
        <Toggle
          label={spec.label}
          value={(value as boolean) ?? spec.default}
          onChange={onChange}
        />
      );
    case 'enum':
      return (
        <Select
          label={spec.label}
          value={(value as number) ?? spec.default}
          options={spec.options}
          onChange={onChange}
        />
      );
    case 'color':
      return (
        <ColorField
          label={spec.label}
          value={(value as Rgb) ?? spec.default}
          onChange={onChange}
        />
      );
    case 'vec2':
      return (
        <Vec2Field
          label={spec.label}
          value={(value as Vec2) ?? spec.default}
          defaultValue={spec.default}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          onChange={onChange}
        />
      );
  }
};

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

  // Reported from inside the render loop, which knows nothing about React;
  // this is the subscription that brings it back across.
  const shaderError = useSyncExternalStore(
    subscribeShaderErrors,
    () => getShaderError(data.effectId),
  );

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

      {/*
        A module whose shader would not compile still renders its controls,
        because they are what you would reach for to fix it. What it must not
        do is look like it is working: the pass falls through untouched, so
        without this the node would sit there doing nothing in silence.
      */}
      {shaderError && (
        <div className="node-body node-warning" title={shaderError}>
          Shader error — this module is passing through. See the console.
        </div>
      )}

      <div className="node-body">
        {paramsOf(def).map((spec) => (
          <Control
            key={spec.key}
            spec={spec}
            value={data.params[spec.key]}
            onChange={(value) => setParam(id, spec.key, value)}
          />
        ))}
      </div>

      <Handle type="target" position={Position.Left} className="port port-in" />
      <Handle type="source" position={Position.Right} className="port port-out" />
    </div>
  );
};
