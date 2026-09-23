import React, { useSyncExternalStore } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Sparkles } from 'lucide-react';
import { isParamPort, paramPort, type EffectNodeData } from '../state/graph';
import { getEffect } from '../engine/registry';
import { inputsOf, paramsOf, type ParamSpec, type ParamValue, type Rgb, type Vec2 } from '../engine/effects';
import { isModulatable } from '../engine/modulators';
import { useGraph } from '../state/store';
import { getShaderError, subscribeShaderErrors } from '../engine/shaderErrors';
import { ColorField, Select, Slider, Toggle, Vec2Field } from './controlPrimitives';

/**
 * One control, picked from the param's kind.
 *
 * Split out so the node body stays a map over specs: the only thing that
 * ever needs touching when a new param kind is added is this switch.
 */
export const Control: React.FC<{
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
 * A param's control, with a modulation port on the card's edge beside it
 * if the param can take one.
 *
 * The port is laid out with the row rather than placed by coordinates, so
 * it stays level with its slider however many rows the card grows above
 * it -- a shader warning appearing, say.
 */
const ParamRow: React.FC<{
  spec: ParamSpec;
  value: ParamValue | undefined;
  modulated: boolean;
  onChange: (value: ParamValue) => void;
}> = ({ spec, value, modulated, onChange }) => {
  if (!isModulatable(spec)) return <Control spec={spec} value={value} onChange={onChange} />;
  return (
    <div className={'param-row' + (modulated ? ' is-modulated' : '')}>
      <Handle
        type="target"
        id={paramPort(spec.key)}
        position={Position.Left}
        className="port port-param"
        title={'Modulate ' + spec.label}
      />
      <Control spec={spec} value={value} onChange={onChange} />
    </div>
  );
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

  // Which params have a modulator wired in, as a string so the selector
  // only wakes this card when that set actually changes.
  const modulatedPorts = useGraph((state) =>
    state.edges
      .filter((edge) => edge.target === id && isParamPort(edge.targetHandle))
      .map((edge) => edge.targetHandle)
      .join(' '),
  );
  const modulated = new Set(modulatedPorts.split(' '));

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

  const inputs = inputsOf(def);

  return (
    <div className="node node-effect">
      {/*
        First in the DOM on purpose. An edge that names no target handle is
        drawn to the first target handle React Flow finds on the node, in
        document order -- and the main input is the one without a name.
      */}
      <Handle type="target" position={Position.Left} className="port port-in port-title" />

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
        {inputs.map((input) => (
          <div className="node-input" key={input.key}>
            <Handle type="target" id={input.key} position={Position.Left} className="port port-in" />
            <span className="control-label">{input.label}</span>
          </div>
        ))}
        {paramsOf(def).map((spec) => (
          <ParamRow
            key={spec.key}
            spec={spec}
            value={data.params[spec.key]}
            modulated={modulated.has(paramPort(spec.key))}
            onChange={(value) => setParam(id, spec.key, value)}
          />
        ))}
      </div>

      <Handle type="source" position={Position.Right} className="port port-out port-title" />
    </div>
  );
};
