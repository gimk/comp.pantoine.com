import React, { useMemo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Activity, Sigma } from 'lucide-react';
import { MOD_OUTPUT, resolveSignal, type ModulatorNodeData } from '../state/graph';
import {
  derivedParams,
  evaluateSignal,
  getModulator,
  modulatorParamsOf,
  modulatorPortsOf,
  signalBounds,
  signalIsMoving,
  signalKey,
  type Signal,
} from '../engine/modulators';
import { useGraph } from '../state/store';
import { ParamRow } from './EffectNode';

const SCOPE_WIDTH = 170;
const SCOPE_HEIGHT = 34;
/**
 * Seconds of signal the scope shows. Fixed at one, so the trace reads
 * directly against Rate: 1 Hz is one cycle, 3 Hz is three.
 */
const SCOPE_SECONDS = 1;
const SCOPE_SAMPLES = 160;
/** Inset from the top and bottom edges, so the trace's stroke is not clipped. */
const SCOPE_PAD = 3;

/** A scope label: as many places as it needs, up to two. */
const formatBound = (value: number): string => String(Math.round(value * 100) / 100);

/**
 * One second of this node's output, drawn from the same function the
 * renderer calls -- inputs included -- so the picture of the signal cannot
 * drift from what it does.
 *
 * Scaled to the lowest and highest the signal can reach, which are
 * written at the side: with raw numbers, those two figures are the answer
 * to "what will this do to the knob I plug it into?". A flat signal shows
 * as a line through the middle, with its one value -- a Pulse whose Chance
 * is 0, say.
 *
 * Still rather than scrolling. A moving trace would need a frame loop per
 * card for something that only changes when a knob or a wire does, and
 * what you need to see -- the shape, how fast, how far -- is all there
 * standing still.
 */
const Scope: React.FC<{ signal: Signal }> = ({ signal }) => {
  const values: number[] = [];
  for (let i = 0; i <= SCOPE_SAMPLES; i += 1) {
    values.push(evaluateSignal(signal, (i / SCOPE_SAMPLES) * SCOPE_SECONDS));
  }
  // The signal's true range where it is known -- a random source may not
  // reach its extremes inside the window -- and what was sampled otherwise.
  const known = signalBounds(signal);
  const lo = known ? known[0] : Math.min(...values);
  const hi = known ? known[1] : Math.max(...values);
  const flat = hi - lo < 1e-9;
  const usable = SCOPE_HEIGHT - SCOPE_PAD * 2;
  const points = values.map((v, i) => {
    const x = (i / SCOPE_SAMPLES) * SCOPE_WIDTH;
    const y = flat ? SCOPE_HEIGHT / 2 : SCOPE_PAD + (1 - (v - lo) / (hi - lo)) * usable;
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  return (
    <div className="mod-scope">
      <svg viewBox={`0 0 ${SCOPE_WIDTH} ${SCOPE_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <polyline points={points.join(' ')} className="mod-scope-trace" />
      </svg>
      <span className="mod-scope-bound is-high">{formatBound(hi)}</span>
      {!flat && <span className="mod-scope-bound is-low">{formatBound(lo)}</span>}
      <span className="mod-scope-window">{SCOPE_SECONDS} s</span>
    </div>
  );
};

/**
 * A modulator: no picture in or out, one signal out.
 *
 * Its output goes to the small ports beside a slider -- an effect's, or
 * another modulator's. It sits in the graph like any other node so the
 * binding is something you can see, and so one signal can drive several
 * knobs at once: a wobble and the chroma shift that goes with it, in step.
 */
export const ModulatorNode: React.FC<NodeProps<Node<ModulatorNodeData, 'modulator'>>> = ({
  id,
  data,
}) => {
  const setParam = useGraph((state) => state.setParam);
  const def = getModulator(data.modulatorId);

  // Resolved from the whole graph, since what feeds this node's ports is
  // part of what it puts out. Keyed on a string so a node drag elsewhere,
  // which changes the node array but not this signal, does not recompute.
  const key = useGraph((state) => {
    const signal = resolveSignal(state.nodes, state.edges, id);
    return signal ? JSON.stringify(signalKey(signal)) : '';
  });
  const signal = useMemo(() => {
    const { nodes, edges } = useGraph.getState();
    return resolveSignal(nodes, edges, id);
  }, [id, key]);

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

  const ports = new Set(modulatorPortsOf(def));
  const derived = signal ? derivedParams(signal) : {};
  const Icon = def.role === 'operator' ? Sigma : Activity;

  return (
    <div className="node node-modulator">
      <div className="node-title">
        <Icon size={13} />
        <span>{def.label}</span>
      </div>

      <div className="node-body">
        {/* Only for a signal that moves. One standing still -- a Value, or a
            Math fed only by Values -- would draw a flat line, and its one
            number is already on the card. */}
        {signal && signalIsMoving(signal) && <Scope signal={signal} />}
        {modulatorParamsOf(def).map((spec) => (
          <ParamRow
            key={spec.key}
            nodeId={id}
            spec={spec}
            value={data.params[spec.key]}
            port={ports.has(spec.key)}
            derived={derived[spec.key]}
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
