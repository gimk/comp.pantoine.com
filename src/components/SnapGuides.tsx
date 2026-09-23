import React from 'react';
import { ViewportPortal, useViewport } from '@xyflow/react';
import { useGraph } from '../state/store';

/** Length of each dash, and of each gap, in screen pixels. */
const DASH = 4;

/**
 * The lines a Shift-drag has snapped to.
 *
 * Drawn in graph space through the viewport portal, so they pan and zoom
 * with the nodes; the thickness and dash length are divided by the zoom so
 * they stay the same on screen at any scale.
 */
export const SnapGuides: React.FC = () => {
  const guides = useGraph((state) => state.snapGuides);
  const { zoom } = useViewport();
  if (guides.length === 0) return null;
  const thickness = 1 / zoom;

  return (
    <ViewportPortal>
      {guides.map((guide) => (
        <div
          key={guide.axis}
          className={'snap-guide snap-guide-' + guide.axis}
          style={
            {
              '--dash': DASH / zoom + 'px',
              ...(guide.axis === 'horizontal'
                ? {
                    transform: `translate(${guide.from}px, ${guide.y - thickness / 2}px)`,
                    width: guide.to - guide.from,
                    height: thickness,
                  }
                : {
                    transform: `translate(${guide.x - thickness / 2}px, ${guide.from}px)`,
                    width: thickness,
                    height: guide.to - guide.from,
                  }),
            } as React.CSSProperties
          }
        />
      ))}
    </ViewportPortal>
  );
};
