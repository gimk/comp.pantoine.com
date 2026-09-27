import React, { useCallback, useMemo, useRef, useState } from 'react';
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

export const GradientEditor: React.FC<GradientEditorProps> = ({ nodeId, params, setParam }) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const stopCount = Math.min(8, Math.max(2, (params.stopCount as number) ?? 3));

  // Extract stops from params
  const stops: GradientStop[] = useMemo(() => {
    const list: GradientStop[] = [];
    for (let i = 0; i < stopCount; i++) {
      const defStop = DEFAULT_STOPS[i] ?? { id: i, pos: i / (stopCount - 1), color: [1, 1, 1] };
      const pos = (params[`pos${i}`] as number) ?? defStop.pos;
      const color = (params[`color${i}`] as [number, number, number]) ?? defStop.color;
      list.push({ id: i, pos, color });
    }
    return list;
  }, [params, stopCount]);

  const activeIdx = Math.min(selectedIdx, stops.length - 1);
  const activeStop = stops[activeIdx] ?? stops[0];

  // Helper to commit sorted stops to the store
  const commitStops = useCallback(
    (newStops: { pos: number; color: [number, number, number] }[], selectedStopId?: number) => {
      const sorted = [...newStops].sort((a, b) => a.pos - b.pos);
      setParam(nodeId, 'stopCount', sorted.length);
      for (let i = 0; i < sorted.length; i++) {
        setParam(nodeId, `pos${i}`, sorted[i].pos);
        setParam(nodeId, `color${i}`, sorted[i].color);
      }
      if (selectedStopId !== undefined) {
        const nextIdx = sorted.findIndex((s) => s.pos === newStops[selectedStopId]?.pos);
        if (nextIdx !== -1) {
          setSelectedIdx(nextIdx);
        }
      }
    },
    [nodeId, setParam],
  );

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

  // Click on track: add a new color stop at clicked position
  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (stopCount >= 8) return;
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const roundedPos = Math.round(t * 100) / 100;
    const sampledColor = sampleGradientColor(stops, roundedPos);

    const newStops = [...stops.map((s) => ({ pos: s.pos, color: s.color })), { pos: roundedPos, color: sampledColor }];
    newStops.sort((a, b) => a.pos - b.pos);
    const newIdx = newStops.findIndex((s) => s.pos === roundedPos);

    setParam(nodeId, 'stopCount', newStops.length);
    for (let i = 0; i < newStops.length; i++) {
      setParam(nodeId, `pos${i}`, newStops[i].pos);
      setParam(nodeId, `color${i}`, newStops[i].color);
    }
    setSelectedIdx(newIdx !== -1 ? newIdx : newStops.length - 1);
  };

  // Add a stop at the midpoint of the largest gap
  const handleAddStop = () => {
    if (stopCount >= 8) return;
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
    const roundedPos = Math.round(insertPos * 100) / 100;
    const sampledColor = sampleGradientColor(stops, roundedPos);

    const newStops = [...stops.map((s) => ({ pos: s.pos, color: s.color })), { pos: roundedPos, color: sampledColor }];
    newStops.sort((a, b) => a.pos - b.pos);
    const newIdx = newStops.findIndex((s) => s.pos === roundedPos);

    setParam(nodeId, 'stopCount', newStops.length);
    for (let i = 0; i < newStops.length; i++) {
      setParam(nodeId, `pos${i}`, newStops[i].pos);
      setParam(nodeId, `color${i}`, newStops[i].color);
    }
    setSelectedIdx(newIdx !== -1 ? newIdx : newStops.length - 1);
  };

  // Delete currently selected stop
  const handleDeleteStop = () => {
    if (stopCount <= 2) return;
    const remaining = stops
      .filter((_, idx) => idx !== activeIdx)
      .map((s) => ({ pos: s.pos, color: s.color }));
    commitStops(remaining);
    setSelectedIdx(Math.max(0, activeIdx - 1));
  };

  // Reverse gradient stops
  const handleReverseGradient = () => {
    const reversed = stops.map((s) => ({
      pos: Math.round((1.0 - s.pos) * 100) / 100,
      color: s.color,
    }));
    commitStops(reversed, activeIdx);
  };

  // Color change for active stop
  const handleColorChange = (newColor: Rgb) => {
    setParam(nodeId, `color${activeIdx}`, newColor);
  };

  // Position change from slider / input
  const handlePosChange = (newPos: number) => {
    const clamped = Math.max(0, Math.min(1, newPos));
    setParam(nodeId, `pos${activeIdx}`, clamped);
  };

  // Dragging stop thumb along the track
  const handleThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedIdx(idx);

    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();

    const onPointerMove = (moveEvt: PointerEvent) => {
      const t = Math.max(0, Math.min(1, (moveEvt.clientX - rect.left) / rect.width));
      const rounded = Math.round(t * 100) / 100;
      setParam(nodeId, `pos${idx}`, rounded);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      // Re-read latest stops from params and commit sorted
      const currNode = useGraph.getState().nodes.find((n) => n.id === nodeId);
      const currParams = currNode?.data && 'params' in currNode.data ? (currNode.data.params as Record<string, ParamValue>) : params;
      const count = Math.min(8, Math.max(2, (currParams.stopCount as number) ?? stopCount));

      const updatedStops: { pos: number; color: [number, number, number]; wasSelected: boolean }[] = [];
      for (let i = 0; i < count; i++) {
        const p = (currParams[`pos${i}`] as number) ?? (i / (count - 1));
        const c = (currParams[`color${i}`] as [number, number, number]) ?? [0, 0, 0];
        updatedStops.push({ pos: p, color: c, wasSelected: i === idx });
      }

      updatedStops.sort((a, b) => a.pos - b.pos);
      setParam(nodeId, 'stopCount', updatedStops.length);
      let newSelected = 0;
      for (let i = 0; i < updatedStops.length; i++) {
        setParam(nodeId, `pos${i}`, updatedStops[i].pos);
        setParam(nodeId, `color${i}`, updatedStops[i].color);
        if (updatedStops[i].wasSelected) {
          newSelected = i;
        }
      }
      setSelectedIdx(newSelected);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
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
            onClick={handleReverseGradient}
          >
            <ArrowLeftRight size={11} />
          </button>
          <button
            type="button"
            className="gradient-btn gradient-btn-icon nodrag"
            title={stopCount >= 8 ? 'Maximum 8 stops reached' : 'Add color stop'}
            disabled={stopCount >= 8}
            onClick={handleAddStop}
          >
            <Plus size={12} />
          </button>
          <button
            type="button"
            className="gradient-btn gradient-btn-icon nodrag"
            title={stopCount <= 2 ? 'Minimum 2 stops required' : 'Delete selected stop'}
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
          style={{ background: gradientCss }}
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
              <span className="control-swatch nodrag" title="Change stop color">
                <input
                  type="color"
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
              min={0}
              max={100}
              step={1}
              value={Math.round(activeStop.pos * 100)}
              onChange={(e) => handlePosChange(Number(e.target.value) / 100)}
              onPointerUp={() => commitStops(stops.map((s) => ({ pos: s.pos, color: s.color })), activeIdx)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
