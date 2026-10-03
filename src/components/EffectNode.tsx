import React, { useMemo, useSyncExternalStore } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  Aperture,
  CassetteTape,
  History,
  Layers,
  Move,
  Palette,
  Sparkles,
  Tv,
  Waves,
} from 'lucide-react';
import { paramPort, resolveSignal, wireKind, type EffectNodeData } from '../state/graph';
import { getEffect } from '../engine/registry';
import {
  acceptsField,
  inputsOf,
  paramsOf,
  type Category,
  type ParamSpec,
  type ParamValue,
  type Rgb,
  type Vec2,
} from '../engine/effects';
import { isModulatable, readPort, signalIsMoving, signalKey, type Signal } from '../engine/modulators';
import { useGraph } from '../state/store';
import { getShaderError, subscribeShaderErrors } from '../engine/shaderErrors';
import { ColorField, NumberField, Select, Slider, Toggle, Vec2Field, type LiveReading } from './controlPrimitives';

const CATEGORY_ICONS: Record<Category, React.ComponentType<{ size?: number }>> = {
  color: Palette,
  stylize: Sparkles,
  optics: Aperture,
  geometry: Move,
  crt: Tv,
  tape: CassetteTape,
  noise: Waves,
  temporal: History,
  composite: Layers,
  generator: Sparkles,
};

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
  /** The value a wired param is receiving, if one is wired. */
  live?: LiveReading;
}> = ({ spec, value, onChange, live }) => {
  switch (spec.kind) {
    case 'float':
      if (spec.field) {
        return (
          <NumberField
            label={spec.label}
            value={(value as number) ?? spec.default}
            step={spec.step}
            onChange={onChange}
            live={live}
          />
        );
      }
      return (
        <Slider
          label={spec.label}
          value={(value as number) ?? spec.default}
          defaultValue={spec.default}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          onChange={onChange}
          live={live}
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
          live={live}
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
 * The signal wired into one param port, or null if nothing is.
 *
 * The selector reduces it to a string, so the card re-renders only when
 * the signal itself changes -- not on every node drag elsewhere, which
 * hands the store a new node array without changing anything here.
 */
const usePortSignal = (nodeId: string, key: string, enabled: boolean): Signal | null => {
  const handle = paramPort(key);
  const sourceId = useGraph((state) =>
    enabled ? state.edges.find((edge) => edge.target === nodeId && edge.targetHandle === handle)?.source : undefined,
  );
  const signature = useGraph((state) => {
    if (!sourceId) return '';
    const signal = resolveSignal(state.nodes, state.edges, sourceId);
    return signal ? JSON.stringify(signalKey(signal)) : '';
  });
  return useMemo(() => {
    if (!sourceId || !signature) return null;
    const { nodes, edges } = useGraph.getState();
    return resolveSignal(nodes, edges, sourceId);
  }, [sourceId, signature]);
};

/**
 * A param's control, with a modulation port on the card's edge beside it
 * if the param can take one.
 *
 * The port is laid out with the row rather than placed by coordinates, so
 * it stays level with its slider however many rows the card grows above
 * it -- a shader warning appearing, say.
 */
export const ParamRow: React.FC<{
  nodeId: string;
  spec: ParamSpec;
  value: ParamValue | undefined;
  /** Whether this param takes a wire at all. */
  port: boolean;
  /** Whether it also takes a picture, as a field: a diamond socket. */
  field?: boolean;
  /** A value the node works out for this param itself, if it does. */
  derived?: number;
  /** Has no effect given the node's other params: dimmed, still editable. */
  inactive?: boolean;
  /**
   * The socket's handle id, when the row is drawn on another card -- a
   * group's, which has its own ids for its ports. Null draws no socket
   * while still showing what drives the param.
   */
  handleId?: string | null;
  onChange: (value: ParamValue) => void;
}> = ({ nodeId, spec, value, port, field = false, derived, inactive = false, handleId, onChange }) => {
  const handle = paramPort(spec.key);
  // What the wire into this port carries, if there is one -- a string, so
  // the row re-renders only when that changes.
  const wired = useGraph((state) => {
    if (!port) return '';
    const edge = state.edges.find((candidate) => candidate.target === nodeId && candidate.targetHandle === handle);
    return edge ? wireKind(state.nodes, state.edges, edge) : '';
  });
  const signal = usePortSignal(nodeId, spec.key, wired === 'signal');
  const live = useMemo<LiveReading | undefined>(() => {
    if (!signal && derived !== undefined) return { read: () => derived, moving: false, derived: true };
    if (!signal || !isModulatable(spec)) return undefined;
    // A slider's minimum guards the effect behind it, so what arrives is
    // held above it; a free field has no range to keep.
    const range = !(spec.kind === 'float' && spec.field);
    return { read: (time) => readPort(spec, signal, time, range), moving: signalIsMoving(signal) };
  }, [signal, spec, derived]);

  if (!port) {
    if (!inactive) return <Control spec={spec} value={value} onChange={onChange} />;
    return (
      <div className="param-row is-inactive">
        <div className="param-control">
          <Control spec={spec} value={value} onChange={onChange} />
        </div>
      </div>
    );
  }

  /*
   * A picture has a value per pixel, and a signal into a toggle, a menu, a
   * colour or a point is converted rather than shown -- so for those the
   * control stays exactly where and as big as it was, greyed out and
   * locked, as a linked socket is. The card never reflows when a wire goes
   * in. A red link leaves the control in charge, and says so on its port.
   */
  const locked = wired === 'field' || (wired === 'signal' && !isModulatable(spec));

  return (
    <div
      className={'param-row' + (spec.kind === 'float' && spec.field ? ' is-field' : '') + (inactive ? ' is-inactive' : '')}
    >
      {handleId !== null && <Handle
        type="target"
        id={handleId ?? handle}
        position={Position.Left}
        className={
          'port port-param' +
          (field ? ' port-field' : '') +
          (wired === 'field' ? ' is-field-wired' : '') +
          (wired === 'invalid' ? ' is-invalid' : '')
        }
        title={
          wired === 'invalid'
            ? `${spec.label} needs a single number, but a picture reaches it through a Math`
            : (field ? 'Drive with a number or a picture: ' : 'Drive with a number: ') + spec.label
        }
      />}
      <div
        className={'param-control' + (locked ? ' is-locked' : '')}
        aria-disabled={locked || undefined}
        title={locked ? (wired === 'field' ? `${spec.label} is driven by a picture` : `${spec.label} is driven by a signal`) : undefined}
      >
        <Control spec={spec} value={value} onChange={onChange} live={live} />
      </div>
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
  const CategoryIcon = CATEGORY_ICONS[def.category] ?? Sparkles;

  return (
    <div className="node node-effect">
      {/*
        First in the DOM on purpose. An edge that names no target handle is
        drawn to the first target handle React Flow finds on the node, in
        document order -- and the main input is the one without a name.
      */}
      <Handle type="target" position={Position.Left} className="port port-in port-title" />

      <div className="node-title">
        <CategoryIcon size={13} />
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
            nodeId={id}
            spec={spec}
            value={data.params[spec.key]}
            port={!spec.portless}
            field={acceptsField(def, spec)}
            inactive={spec.activeWhen ? !spec.activeWhen(data.params) : false}
            onChange={(value) => setParam(id, spec.key, value)}
          />
        ))}
      </div>

      <Handle type="source" position={Position.Right} className="port port-out port-title" />
    </div>
  );
};
