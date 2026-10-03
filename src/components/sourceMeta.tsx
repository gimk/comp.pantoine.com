import React from 'react';

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * The shape of a picture, as people say it: 16:9 or 4:3 when the sides reduce
 * to small numbers, and 2.39:1 when they don't (1366 x 768 is no one's 683:384).
 */
export const aspectLabel = (width: number, height: number): string | null => {
  if (!(width > 0 && height > 0)) return null;
  const d = gcd(Math.round(width), Math.round(height));
  const w = Math.round(width) / d;
  const h = Math.round(height) / d;
  if (w <= 32 && h <= 32) return `${w}:${h}`;
  return `${(width / height).toFixed(2).replace(/\.?0+$/, '')}:1`;
};

export const formatDuration = (sec: number): string => {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/**
 * What a source card says about its file: the name on its own line, so a long
 * one only ever truncates against the card edge, and the numbers beneath it.
 */
export const SourceMeta: React.FC<{ name: string; width: number; height: number; extra?: string }> = ({
  name,
  width,
  height,
  extra,
}) => {
  const aspect = aspectLabel(width, height);
  return (
    <div className="node-meta">
      <span className="node-meta-name" title={name}>
        {name}
      </span>
      <span className="node-meta-detail">
        <span>
          {width} &times; {height}
        </span>
        {aspect && <span>{aspect}</span>}
        {extra && <span>{extra}</span>}
      </span>
    </div>
  );
};
