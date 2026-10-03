import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, ArrowLeftRight } from 'lucide-react';
import type { ParamValue, Rgb } from '../engine/effects';
import { toHex, fromHex } from './controlPrimitives';
import { useGraph } from '../state/store';

export type GradientStop = {
  id: number;
  pos: number;
  color: [number, number, number];
};

const DEFAULT_STOPS: GradientStop[] = [
  { id: 0, pos: 0.0, color: [0.06, 0.05, 0.18] },
  { id: 1, pos: 0.5, color: [0.92, 0.22, 0.54] },
  { id: 2, pos: 1.0, color: [0.98, 0.78, 0.25] },
];

/**
 * Sample RGB color from stops array at position t (0..1) with linear interpolation.
 */
export const sampleGradientColor = (
  stops: { pos: number; color: [number, number, number] }[],
  t: number,
): [number, number, number] => {
  if (stops.length === 0) return [1, 1, 1];
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  if (t <= sorted[0].pos) return [...sorted[0].color];
  if (t >= sorted[sorted.length - 1].pos) return [...sorted[sorted.length - 1].color];

  for (let i = 0; i < sorted.length - 1; i++) {
    const s0 = sorted[i];
    const s1 = sorted[i + 1];
    if (t >= s0.pos && t <= s1.pos) {
      const span = Math.max(s1.pos - s0.pos, 0.00001);
      const u = (t - s0.pos) / span;
      return [
        s0.color[0] + (s1.color[0] - s0.color[0]) * u,
        s0.color[1] + (s1.color[1] - s0.color[1]) * u,
        s0.color[2] + (s1.color[2] - s0.color[2]) * u,
      ];
    }
  }
  return [...sorted[sorted.length - 1].color];
};

interface GradientEditorProps {
  nodeId: string;
  params: Record<string, ParamValue>;
  setParam: (id: string, key: string, value: ParamValue) => void;
}

type StopValue = { pos: number; color: [number, number, number] };

const MAX_STOPS = 8;
const MIN_STOPS = 2;

const clampCount = (count: number | undefined, fallback: number) =>
  Math.min(MAX_STOPS, Math.max(MIN_STOPS, count ?? fallback));

/** The stops as stored in a node's params, in slot order. */
const readStops = (params: Record<string, ParamValue>, fallbackCount = 3): StopValue[] => {
  const count = clampCount(params.stopCount as number | undefined, fallbackCount);
  const list: StopValue[] = [];
  for (let i = 0; i < count; i++) {
    const defStop = DEFAULT_STOPS[i] ?? { pos: i / (count - 1), color: [1, 1, 1] as [number, number, number] };
    list.push({
      pos: (params[`pos${i}`] as number) ?? defStop.pos,
      color: (params[`color${i}`] as [number, number, number]) ?? defStop.color,
    });
  }
  return list;
};

export const GradientEditor: React.FC<GradientEditorProps> = ({ nodeId, params, setParam }) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  // Detaches an in-flight thumb drag's window listeners; also run on unmount
  // so a node deleted mid-drag doesn't leave them behind.
  const endDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endDragRef.current?.(), []);

  const stopCount = clampCount(params.stopCount as number | undefined, 3);

  const stops: GradientStop[] = useMemo(
    () => readStops(params).map((stop, id) => ({ id, ...stop })),
    [params],
  );

  const activeIdx = Math.min(selectedIdx, stops.length - 1);
  const activeStop = stops[activeIdx] ?? stops[0];

  /*
   * Every structural edit goes through here. The Ramp shader walks the
   * stops in slot order and expects them sorted, so they are sorted on every
   * commit -- not just when a drag ends -- and written as one patch: one
   * store update, one undo step, instead of a write per slot. `selected` is
   * the index, in `next`, of the stop that should stay selected; it's
   * followed through the sort so the selection sticks to the same stop, not
   * the same slot. Returns that stop's new index.
   */
  const commitStops = useCallback(
    (next: StopValue[], selected: number): number => {
      const order = next.map((stop, i) => ({ stop, i })).sort((a, b) => a.stop.pos - b.stop.pos);
      const patch: Record<string, ParamValue> = { stopCount: order.length };
      order.forEach(({ stop }, slot) => {
        patch[`pos${slot}`] = stop.pos;
        patch[`color${slot}`] = stop.color;
      });
      useGraph.getState().setEffectParams(nodeId, patch);
      const nextIdx = Math.max(0, order.findIndex(({ i }) => i === selected));
      setSelectedIdx(nextIdx);
      return nextIdx;
    },
    [nodeId],
  );

  /** The latest stops from the store, not the (possibly stale) render's. */
  const latestStops = (): StopValue[] => {
    const node = useGraph.getState().nodes.find((n) => n.id === nodeId);
    const current = node?.data && 'params' in node.data ? (node.data.params as Record<string, ParamValue>) : params;
    return readStops(current);
  };

  // CSS linear-gradient string for the visual preview track
  const gradientCss = useMemo(() => {
    const sorted = [...stops].sort((a, b) => a.pos - b.pos);
    const parts = sorted.map((s) => {
      const r = Math.round(s.color[0] * 255);
      const g = Math.round(s.color[1] * 255);
      const b = Math.round(s.color[2] * 255);
      const p = (s.pos * 100).toFixed(1);
      return `rgb(${r}, ${g}, ${b}) ${p}%`;
    });
    return `linear-gradient(to right, ${parts.join(', ')})`;
  }, [stops]);

  const addStopAt = (pos: number) => {
    if (stopCount >= MAX_STOPS) return;
    const rounded = Math.round(pos * 100) / 100;
    const current = latestStops();
    commitStops([...current, { pos: rounded, color: sampleGradientColor(current, rounded) }], current.length);
  };

  // Click on track: add a new color stop at clicked position
  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    addStopAt(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  };

  // Add a stop at the midpoint of the largest gap
  const handleAddStop = () => {
    const sorted = [...stops].sort((a, b) => a.pos - b.pos);
    let maxGap = -1;
    let insertPos = 0.5;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].pos - sorted[i].pos;
      if (gap > maxGap) {
        maxGap = gap;
        insertPos = (sorted[i].pos + sorted[i + 1].pos) / 2;
      }
    }
    addStopAt(insertPos);
  };

  // Delete currently selected stop
  const handleDeleteStop = () => {
    if (stopCount <= MIN_STOPS) return;
    const remaining = latestStops().filter((_, idx) => idx !== activeIdx);
    commitStops(remaining, Math.max(0, activeIdx - 1));
  };

  // Reverse gradient stops
  const handleReverseGradient = () => {
    const reversed = latestStops().map((s) => ({ pos: Math.round((1.0 - s.pos) * 100) / 100, color: s.color }));
    commitStops(reversed, activeIdx);
  };

  // Color change for active stop: order is unaffected, one param is enough.
  const handleColorChange = (newColor: Rgb) => {
    setParam(nodeId, `color${activeIdx}`, newColor);
  };

  // Position change from the slider -- pointer or keyboard alike -- re-sorts
  // straight away, so the stored order is never left out of step.
  const handlePosChange = (newPos: number) => {
    const next = latestStops();
    next[activeIdx] = { ...next[activeIdx], pos: Math.max(0, Math.min(1, newPos)) };
    commitStops(next, activeIdx);
  };

  // Dragging stop thumb along the track
  const handleThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedIdx(idx);
    endDragRef.current?.();

    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    // The dragged stop's slot moves as it passes its neighbours.
    let dragged = idx;

    const onPointerMove = (moveEvt: PointerEvent) => {
      const t = Math.max(0, Math.min(1, (moveEvt.clientX - rect.left) / rect.width));
      const next = latestStops();
      if (!next[dragged]) return;
      next[dragged] = { ...next[dragged], pos: Math.round(t * 100) / 100 };
      dragged = commitStops(next, dragged);
    };

    const endDrag = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      if (endDragRef.current === endDrag) endDragRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    endDragRef.current = endDrag;
  };

  return (
    <div className="gradient-editor nodrag">
      <div className="control-row">
        <span className="control-label">Gradient</span>
        <div className="gradient-btn-group">
          <button
            type="button"
            className="gradient-btn gradient-btn-icon nodrag"
            title="Reverse gradient"
            aria-label="Reverse gradient"
            onClick={handleReverseGradient}
          >
            <ArrowLeftRight size={11} />
          </button>
          <button
            type="button"
            className="gradient-btn gradient-btn-icon nodrag"
            title={stopCount >= 8 ? 'Maximum 8 stops reached' : 'Add color stop'}
            aria-label="Add color stop"
            disabled={stopCount >= 8}
            onClick={handleAddStop}
          >
            <Plus size={12} />
          </button>
          <button
            type="button"
            className="gradient-btn gradient-btn-icon nodrag"
            title={stopCount <= 2 ? 'Minimum 2 stops required' : 'Delete selected stop'}
            aria-label="Delete selected stop"
            disabled={stopCount <= 2}
            onClick={handleDeleteStop}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Visual Gradient Track with Click-to-Add */}
      <div className="gradient-track-wrap">
        <div
          ref={trackRef}
          className="gradient-track nodrag"
          style={{ backgroundImage: gradientCss }}
          onClick={handleTrackClick}
          title="Click gradient bar to add a color stop"
        />

        {/* Draggable Stop Markers (Thumbs) */}
        <div className="gradient-stops-bar nodrag">
          {stops.map((stop, idx) => {
            const isSelected = idx === activeIdx;
            const r = Math.round(stop.color[0] * 255);
            const g = Math.round(stop.color[1] * 255);
            const b = Math.round(stop.color[2] * 255);

            return (
              <div
                key={idx}
                className={`gradient-stop-thumb nodrag ${isSelected ? 'is-selected' : ''}`}
                style={{ left: `${Math.max(0, Math.min(1, stop.pos)) * 100}%` }}
                onPointerDown={(e) => handleThumbPointerDown(e, idx)}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedIdx(idx);
                }}
                title={`Stop ${idx + 1}: ${Math.round(stop.pos * 100)}%`}
              >
                <div className="gradient-stop-tip" />
                <div className="gradient-stop-color" style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Stop Inspector */}
      {activeStop && (
        <div className="gradient-stop-inspector">
          <div className="control-row">
            <span className="control-label">Stop {activeIdx + 1} of {stopCount}</span>
            <div className="gradient-active-controls">
              <span
                className="control-swatch nodrag"
                title="Change stop color"
                style={{ '--swatch': toHex(activeStop.color) } as React.CSSProperties}
              >
                <input
                  type="color"
                  aria-label={`Stop ${activeIdx + 1} color`}
                  value={toHex(activeStop.color)}
                  onChange={(e) => handleColorChange(fromHex(e.target.value))}
                />
              </span>
              <span className="control-value">{Math.round(activeStop.pos * 100)}%</span>
            </div>
          </div>
          <div className="control-row">
            <span className="control-label">Position</span>
            <input
              type="range"
              className="control-slider nodrag"
              aria-label={`Stop ${activeIdx + 1} position`}
              min={0}
              max={100}
              step={1}
              value={Math.round(activeStop.pos * 100)}
              onChange={(e) => handlePosChange(Number(e.target.value) / 100)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
