import { describe, expect, it } from 'vitest';
import {
  distanceToBox,
  findEdgeUnderNodeWithElements,
  type EdgePathCandidate,
  type NodeBox,
} from './edgeHitTest';

describe('edgeHitTest', () => {
  describe('distanceToBox', () => {
    const box = { x: 100, y: 100, width: 200, height: 100 };

    it('returns 0 for points inside the box', () => {
      expect(distanceToBox(150, 150, box.x, box.y, box.width, box.height)).toBe(0);
      expect(distanceToBox(100, 100, box.x, box.y, box.width, box.height)).toBe(0);
      expect(distanceToBox(300, 200, box.x, box.y, box.width, box.height)).toBe(0);
    });

    it('calculates correct distance for points outside borders', () => {
      // 10px to the left
      expect(distanceToBox(90, 150, box.x, box.y, box.width, box.height)).toBe(10);
      // 20px to the right
      expect(distanceToBox(320, 150, box.x, box.y, box.width, box.height)).toBe(20);
      // 15px above
      expect(distanceToBox(150, 85, box.x, box.y, box.width, box.height)).toBe(15);
      // 25px below
      expect(distanceToBox(150, 225, box.x, box.y, box.width, box.height)).toBe(25);
    });

    it('calculates Euclidean distance for points diagonally outside', () => {
      // 3px left, 4px above top-left corner -> distance 5
      expect(distanceToBox(97, 96, box.x, box.y, box.width, box.height)).toBe(5);
    });
  });

  describe('findEdgeUnderNodeWithElements', () => {
    const createMockCandidate = (
      id: string,
      start: { x: number; y: number },
      end: { x: number; y: number },
    ): EdgePathCandidate => {
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      return {
        id,
        getTotalLength: () => length,
        getPointAtLength: (d: number) => {
          const t = length === 0 ? 0 : d / length;
          return {
            x: start.x + (end.x - start.x) * t,
            y: start.y + (end.y - start.y) * t,
          };
        },
      };
    };

    it('detects an edge crossing through the middle of the module', () => {
      // Node is 196x120 at (100, 100), center is (198, 160)
      const nodeBox: NodeBox = { x: 100, y: 100, width: 196, height: 120 };
      const edges = [createMockCandidate('edge-1', { x: 0, y: 160 }, { x: 400, y: 160 })];

      const hit = findEdgeUnderNodeWithElements(nodeBox, edges, new Set());
      expect(hit).toBe('edge-1');
    });

    it('permissively detects an edge that only crosses the edge of the module', () => {
      // Node is 196x120 at (100, 100), center is (198, 160)
      const nodeBox: NodeBox = { x: 100, y: 100, width: 196, height: 120 };
      // Edge crosses vertically near the left border (x = 105), which is ~93px from the center
      const edges = [createMockCandidate('edge-left', { x: 105, y: 0 }, { x: 105, y: 400 })];

      const hit = findEdgeUnderNodeWithElements(nodeBox, edges, new Set());
      expect(hit).toBe('edge-left');
    });

    it('ignores edges outside the node and tolerance margin', () => {
      const nodeBox: NodeBox = { x: 100, y: 100, width: 196, height: 120 };
      // Edge far away at y = 500
      const edges = [createMockCandidate('edge-far', { x: 0, y: 500 }, { x: 400, y: 500 })];

      const hit = findEdgeUnderNodeWithElements(nodeBox, edges, new Set());
      expect(hit).toBeNull();
    });

    it('ignores excluded edges (e.g. the node own wires)', () => {
      const nodeBox: NodeBox = { x: 100, y: 100, width: 196, height: 120 };
      const edges = [createMockCandidate('own-wire', { x: 0, y: 160 }, { x: 400, y: 160 })];

      const hit = findEdgeUnderNodeWithElements(nodeBox, edges, new Set(['own-wire']));
      expect(hit).toBeNull();
    });

    it('selects the edge closest to center when multiple edges cross the module', () => {
      const nodeBox: NodeBox = { x: 100, y: 100, width: 196, height: 120 }; // center at y = 160
      const edges = [
        // edge-border crosses near top border at y = 105 (distance to center = 55)
        createMockCandidate('edge-border', { x: 0, y: 105 }, { x: 400, y: 105 }),
        // edge-center crosses near center at y = 158 (distance to center = 2)
        createMockCandidate('edge-center', { x: 0, y: 158 }, { x: 400, y: 158 }),
      ];

      const hit = findEdgeUnderNodeWithElements(nodeBox, edges, new Set());
      expect(hit).toBe('edge-center');
    });
  });
});
