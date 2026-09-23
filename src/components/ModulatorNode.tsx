import React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Activity } from 'lucide-react';
import { MOD_OUTPUT, type ModulatorNodeData } from '../state/graph';
import { getModulator, modulatorParamsOf, type ModulatorDef } from '../engine/modulators';
import type { ParamValue } from '../engine/effects';
import { useGraph } from '../state/store';
import { Control } from './EffectNode';

const SCOPE_WIDTH = 170;
const SCOPE_HEIGHT = 34;
/** Seconds of signal the scope shows, so a faster rate packs more cycles in. */
const SCOPE_SECONDS = 4;
const SCOPE_SAMPLES = 120;

/**
 * Four seconds of the signal, drawn from the same function the renderer
 * calls, so the picture of the wave cannot drift from what it does.
 *
 * Still rather than scrolling. A moving trace would need a frame loop per
 * card for something that only changes when a knob does, and what you need
 * to see -- the shape, how fast, how far -- is all there standing still.
 * Depth scales the trace, so a modulator dialled to nothing looks flat.
 */
const Scope: React.FC<{ def: ModulatorDef; params: Record<string, ParamValue>; seed: number }> = ({
  def,
  params,
  seed,
}) => {
  const depth = typeof params.depth === 'number' ? params.depth : 0;
  const mid = SCOPE_HEIGHT / 2;
  const points: string[] = [];
  for (let i = 0; i <= SCOPE_SAMPLES; i += 1) {
    const t = (i / SCOPE_SAMPLES) * SCOPE_SECONDS;
    const x = (i / SCOPE_SAMPLES) * SCOPE_WIDTH;
    const y = mid - def.sample(params, t, seed) * depth * (mid - 2);
    points.push(x.toFixed(1) + ',' + y.toFixed(1));
  }
  return (
    <svg
      className="mod-scope"
      viewBox={`0 0 ${SCOPE_WIDTH} ${SCOPE_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line x1="0" y1={mid} x2={SCOPE_WIDTH} y2={mid} className="mod-scope-axis" />
      <polyline points={points.join(' ')} className="mod-scope-trace" />
    </svg>
  );
};

/**
 * A modulator: no picture in or out, one signal out.
 *
 * Its output goes to the small ports beside an effect's sliders. It sits
 * in the graph like any other node so the binding is something you can
 * see, and so one LFO can drive several knobs at once -- a wobble and the
 * chroma shift that goes with it, in step.
 */
export const ModulatorNode: React.FC<NodeProps<Node<ModulatorNodeData, 'modulator'>>> = ({
  id,
  data,
}) => {
  const setParam = useGraph((state) => state.setParam);
  const def = getModulator(data.modulatorId);

  if (!def) {
    return (
      <div className="node node-modulator">
        <div className="node-title">
          <span>Unknown modulator</span>
        </div>
        <div className="node-body node-warning">{data.modulatorId}</div>
        <Handle type="source" id={MOD_OUTPUT} position={Position.Right} className="port port-out port-mod" />
      </div>
    );
  }

  return (
    <div className="node node-modulator">
      <div className="node-title">
        <Activity size={13} />
        <span>{def.label}</span>
      </div>

      <div className="node-body">
        {/* The scope's seed does not matter for the periodic shapes, and for
            the random ones any fixed value shows the character of the wave. */}
        <Scope def={def} params={data.params} seed={0.5} />
        {modulatorParamsOf(def).map((spec) => (
          <Control
            key={spec.key}
            spec={spec}
            value={data.params[spec.key]}
            onChange={(value) => setParam(id, spec.key, value)}
          />
        ))}
      </div>

      <Handle
        type="source"
        id={MOD_OUTPUT}
        position={Position.Right}
        className="port port-out port-mod port-title"
      />
    </div>
  );
};
