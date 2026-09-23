import { describe, expect, it } from 'vitest';
import { snapDrag } from './snapping';
import type { AppNode } from './graph';

describe('drag snapping alignment', () => {
  it('returns zero shift and no guides when no other nodes are within snapping range', () => {
    const nodes: AppNode[] = [
      {
        id: 'node-1',
        type: 'image',
        position: { x: 0, y: 0 },
        measured: { width: 100, height: 100 },
        data: { src: null, name: '', width: 0, height: 0 },
      },
    ];

    const origins = new Map([['node-1', { x: 0, y: 0 }]]);
    const result = snapDrag(nodes, origins, { x: 10, y: 10 }, null);

    expect(result.shift).toEqual({ x: 0, y: 0 });
    expect(result.guides).toHaveLength(0);
  });

  it('snaps onto center alignment when dragged close to another node', () => {
    // node-2 is fixed at (200, 100) with size (100, 100) -> center is (250, 150)
    // node-1 starts at (0, 100) with size (100, 100) -> initial center (50, 150)
    // Dragged by delta { x: 0, y: 4 } -> dragged center (50, 154)
    // row line of fixed node is 150, moving node is 154 (diff = -4 <= SNAP_DISTANCE 10)
    const nodes: AppNode[] = [
      {
        id: 'node-1',
        type: 'image',
        position: { x: 0, y: 104 },
        measured: { width: 100, height: 100 },
        data: { src: null, name: '', width: 0, height: 0 },
      },
      {
        id: 'node-2',
        type: 'output',
        position: { x: 200, y: 100 },
        measured: { width: 100, height: 100 },
        data: { width: 360 },
      } as any,
    ];

    const origins = new Map([['node-1', { x: 0, y: 100 }]]);
    const result = snapDrag(nodes, origins, { x: 0, y: 4 }, null);

    expect(result.shift.y).toBe(-4);
    expect(result.guides.some((g) => g.axis === 'horizontal' && g.y === 150)).toBe(true);
  });
});
