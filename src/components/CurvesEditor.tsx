import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { ParamValue, Vec2 } from '../engine/effects';
import {
  CURVE_IDS,
  MAX_POINTS,
  MIN_POINTS,
  evalCurve,
  readCurve,
  writeCurve,
  type CurveId,
} from '../engine/modules/curves';
import { useGraph } from '../state/store';

const TABS: { id: CurveId; label: string }[] = [
  { id: 'm', label: 'RGB' },
  { id: 'r', label: 'R' },
  { id: 'g', label: 'G' },
  { id: 'b', label: 'B' },
];

/** Closest two points may come in x, so neither can pass the other. */
const GAP = 0.01;
/** How far past the box a dragged point goes before it is taken off. */
const REMOVE_BEYOND = 0.12;
const SAMPLES = 64;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 1000) / 1000;

/** An SVG path through the curve, in a 100×100 box with y up. */
const pathOf = (points: Vec2[]): string =>
  Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const x = i / SAMPLES;
    return `${i === 0 ? 'M' : 'L'}${(x * 100).toFixed(2)},${((1 - evalCurve(points, x)) * 100).toFixed(2)}`;
  }).join(' ');

/**
 * The Curves module's points, drawn and edited as curves on the card.
 *
 * Every change is written back as one patch over the curve's count and
 * slots, so a drag step is one store update. Points keep their order: a
 * dragged point stops just short of its neighbours, so a slot never has to
 * be renumbered mid-drag and the point under the pointer stays the same one.
 */
export const CurvesEditor: React.FC<{ nodeId: string; params: Record<string, ParamValue> }> = ({ nodeId, params }) => {
  const [active, setActive] = useState<CurveId>('m');
  const [selected, setSelected] = useState<number | null>(null);
  /** The point being dragged out of the box, which goes if let go there. */
  const [removing, setRemoving] = useState<number | null>(null);
  const boxRef = useRef<SVGSVGElement>(null);
  // Detaches an in-flight drag's window listeners; also run on unmount so a
  // node deleted mid-drag doesn't leave them behind.
  const endDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endDragRef.current?.(), []);

  const curves = useMemo(
    () => Object.fromEntries(CURVE_IDS.map((id) => [id, readCurve(params, id)])) as Record<CurveId, Vec2[]>,
    [params],
  );
  const points = curves[active];

  /** The latest points from the store, not the (possibly stale) render's. */
  const latest = (): Vec2[] => {
    const node = useGraph.getState().nodes.find((n) => n.id === nodeId);
    const current = node?.data && 'params' in node.data ? (node.data.params as Record<string, ParamValue>) : params;
    return readCurve(current, active);
  };

  const commit = (next: Vec2[]) => useGraph.getState().setEffectParams(nodeId, writeCurve(active, next));

  /** The pointer as a point in the curve's 0..1 space, unclamped. */
  const toCurve = (clientX: number, clientY: number): Vec2 | null => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return [(clientX - rect.left) / rect.width, 1 - (clientY - rect.top) / rect.height];
  };

  const removePoint = (index: number) => {
    const next = latest();
    if (next.length <= MIN_POINTS) return;
    next.splice(index, 1);
    commit(next);
    setSelected(null);
  };

  /*
   * A point dragged well out of the box is only marked for removal -- shown
   * fading at the edge -- and goes when it is let go there. Taking it off
   * the moment it crossed the line made an end point dragged into a corner
   * vanish mid-gesture; this way dragging back in keeps it.
   */
  const startDrag = (index: number) => {
    endDragRef.current?.();
    setSelected(index);
    let leaving = false;

    const onMove = (event: PointerEvent) => {
      const at = toCurve(event.clientX, event.clientY);
      if (!at) return;
      const next = latest();
      if (!next[index]) return;
      const outside = Math.max(-at[0], at[0] - 1, -at[1], at[1] - 1);
      const nowLeaving = outside > REMOVE_BEYOND && next.length > MIN_POINTS;
      if (nowLeaving !== leaving) {
        leaving = nowLeaving;
        setRemoving(leaving ? index : null);
      }
      const lo = index > 0 ? next[index - 1][0] + GAP : 0;
      const hi = index < next.length - 1 ? next[index + 1][0] - GAP : 1;
      next[index] = [round(Math.min(hi, Math.max(lo, clamp01(at[0])))), round(clamp01(at[1]))];
      commit(next);
    };

    const endDrag = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', endDrag);
      if (endDragRef.current === endDrag) endDragRef.current = null;
      setRemoving(null);
    };

    const onUp = () => {
      endDrag();
      if (leaving) removePoint(index);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', endDrag);
    endDragRef.current = endDrag;
  };

  /**
   * A press on empty space puts a point on the curve there and drags it; a
   * press right beside an existing point -- too close to fit another --
   * picks that one up instead of doing nothing.
   */
  const handleBoxPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const at = toCurve(event.clientX, event.clientY);
    if (!at) return;
    const current = latest();
    const x = round(clamp01(at[0]));
    const near = current.findIndex((point) => Math.abs(point[0] - x) < GAP * 3);
    if (near >= 0) {
      startDrag(near);
      return;
    }
    if (current.length >= MAX_POINTS) return;
    const next = [...current, [x, round(evalCurve(current, x))] as Vec2].sort((a, b) => a[0] - b[0]);
    commit(next);
    startDrag(next.findIndex((point) => point[0] === x));
  };

  const handleReset = () => {
    commit([
      [0, 0],
      [1, 1],
    ]);
    setSelected(null);
  };

  const selectedPoint = selected !== null ? points[selected] : undefined;

  return (
    <div className="curves-editor nodrag">
      <div className="curves-header">
        <div className="curves-tabs" role="tablist" aria-label="Curve">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === active}
              className={`gradient-btn curves-tab curves-tab-${tab.id}${tab.id === active ? ' is-active' : ''}`}
              onClick={() => {
                setActive(tab.id);
                setSelected(null);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="gradient-btn gradient-btn-icon"
          title="Reset this curve"
          aria-label="Reset this curve"
          onClick={handleReset}
        >
          <RotateCcw size={11} />
        </button>
      </div>

      <svg
        ref={boxRef}
        className={`curves-box curves-box-${active}`}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onPointerDown={handleBoxPointerDown}
      >
        {[25, 50, 75].map((v) => (
          <g key={v} className="curves-grid">
            <line x1={v} y1={0} x2={v} y2={100} />
            <line x1={0} y1={v} x2={100} y2={v} />
          </g>
        ))}
        <line className="curves-diagonal" x1={0} y1={100} x2={100} y2={0} />
        {CURVE_IDS.filter((id) => id !== active).map((id) => (
          <path key={id} className={`curves-line curves-line-${id} is-faint`} d={pathOf(curves[id])} />
        ))}
        <path className={`curves-line curves-line-${active}`} d={pathOf(points)} />
        {points.map(([x, y], index) => (
          <g
            key={index}
            className={
              'curves-point' + (index === selected ? ' is-selected' : '') + (index === removing ? ' is-removing' : '')
            }
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              startDrag(index);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              removePoint(index);
            }}
          >
            <title>Drag to move · double-click or drag out to remove</title>
            {/* A wider, invisible target than the dot: the dot alone is a few pixels across. */}
            <circle className="curves-point-hit" cx={x * 100} cy={(1 - y) * 100} r={7} />
            <circle className="curves-point-dot" cx={x * 100} cy={(1 - y) * 100} r={2.8} />
          </g>
        ))}
      </svg>

      <div className="control-row curves-readout">
        <span className="control-label">
          {points.length} of {MAX_POINTS} points
        </span>
        <span className="control-value">
          {selectedPoint ? `${Math.round(selectedPoint[0] * 255)} → ${Math.round(selectedPoint[1] * 255)}` : '—'}
        </span>
      </div>
    </div>
  );
};
