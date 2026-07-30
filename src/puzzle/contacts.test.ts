/**
 * puzzle/contacts.test.ts — pure spatial overlap checks used by puzzle elements.
 */
import { describe, expect, it } from 'vitest';
import {
  circleIntersectsRectangle,
  pointInAABB,
  pointInCircle,
  pointToSegmentDistanceSquared,
} from './contacts';

describe('pointInAABB', () => {
  it('detects points inside', () => {
    const center = { x: 2, y: 1, z: -1 };
    const half = { x: 1, y: 0.5, z: 1.5 };
    expect(pointInAABB({ x: 2, y: 1, z: -1 }, center, half)).toBe(true);
    expect(pointInAABB({ x: 2.9, y: 1.4, z: 0.4 }, center, half)).toBe(true);
  });

  it('rejects points outside any axis', () => {
    const center = { x: 0, y: 0, z: 0 };
    const half = { x: 1, y: 1, z: 1 };
    expect(pointInAABB({ x: 1.1, y: 0, z: 0 }, center, half)).toBe(false);
    expect(pointInAABB({ x: 0, y: -1.1, z: 0 }, center, half)).toBe(false);
    expect(pointInAABB({ x: 0, y: 0, z: 1.1 }, center, half)).toBe(false);
  });
});

describe('pointInCircle', () => {
  it('detects points within the horizontal disc', () => {
    expect(pointInCircle({ x: 0, y: 0.1, z: 0 }, { x: 0, y: 0, z: 0 }, 1, 0.5)).toBe(true);
    expect(pointInCircle({ x: 0.7, y: 0.2, z: 0 }, { x: 0, y: 0, z: 0 }, 1, 0.5)).toBe(true);
  });

  it('respects radius and height tolerance', () => {
    expect(pointInCircle({ x: 1.1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1, 0.5)).toBe(false);
    expect(pointInCircle({ x: 0, y: 0.8, z: 0 }, { x: 0, y: 0, z: 0 }, 1, 0.5)).toBe(false);
  });
});

describe('pointToSegmentDistanceSquared', () => {
  it('returns 0 for on-line points', () => {
    expect(pointToSegmentDistanceSquared(
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    )).toBe(0);
  });

  it('measures perpendicular distance', () => {
    expect(pointToSegmentDistanceSquared(
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 2, y: 3, z: 0 },
    )).toBeCloseTo(9, 6);
  });

  it('clamps to segment ends', () => {
    expect(pointToSegmentDistanceSquared(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    )).toBeCloseTo(16, 6);
  });
});

describe('circleIntersectsRectangle', () => {
  it('detects a circle entirely inside the rectangle', () => {
    expect(circleIntersectsRectangle(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: 0, y: 0, z: 0 }, 2, 2,
    )).toBe(true);
  });

  it('detects a circle overlapping a corner outside the rectangle', () => {
    expect(circleIntersectsRectangle(
      { x: 3, y: 0, z: 2 }, 1.5,
      { x: 0, y: 0, z: 0 }, 2, 1,
    )).toBe(true);
  });

  it('rejects disjoint shapes', () => {
    expect(circleIntersectsRectangle(
      { x: 5, y: 0, z: 5 }, 1,
      { x: 0, y: 0, z: 0 }, 2, 2,
    )).toBe(false);
  });
});
