/**
 * puzzle/ballistic.test.ts — pure trajectory solver for faith plates.
 */
import { describe, expect, it } from 'vitest';
import { solveBallisticLaunch } from './ballistic';

describe('solveBallisticLaunch', () => {
  it('returns an arcing velocity that reaches a flat target at the same height', () => {
    const start = { x: 0, y: 0, z: 0 };
    const target = { x: 10, y: 0, z: 0 };
    const result = solveBallisticLaunch(start, target, 19.6, 1);

    // Arc is symmetric, so equal horizontal and vertical components, both positive.
    expect(result.velocity.y).toBeGreaterThan(0);
    const speed = Math.hypot(result.velocity.x, result.velocity.y, result.velocity.z);
    // Minimum speed for a flat 10m arc under 19.6 gravity is sqrt(g*d).
    expect(speed).toBeCloseTo(Math.sqrt(19.6 * 10), 1);
    expect(result.velocity.y).toBeCloseTo(Math.hypot(result.velocity.x, result.velocity.z), 5);
  });

  it('overshoots the target area when power > 1', () => {
    const start = { x: 0, y: 0, z: 0 };
    const target = { x: 8, y: 0, z: 0 };
    const base = solveBallisticLaunch(start, target, 19.6, 1);
    const powered = solveBallisticLaunch(start, target, 19.6, 1.4);
    const baseSpeed = Math.hypot(base.velocity.x, base.velocity.y, base.velocity.z);
    const poweredSpeed = Math.hypot(powered.velocity.x, powered.velocity.y, powered.velocity.z);
    expect(poweredSpeed).toBeGreaterThan(baseSpeed);
  });

  it('reaches a higher target', () => {
    const start = { x: 0, y: 0, z: 0 };
    const target = { x: 6, y: 4, z: 0 };
    const result = solveBallisticLaunch(start, target, 19.6, 1);
    expect(result.velocity.y).toBeGreaterThan(0);
    expect(result.scaledBy).toBeGreaterThanOrEqual(1);
  });

  it('never returns NaN for unreachable-looking targets', () => {
    const result = solveBallisticLaunch({ x: 0, y: 0, z: 0 }, { x: 100, y: 50, z: 0 }, 19.6, 0.1);
    expect(Number.isFinite(result.velocity.x)).toBe(true);
    expect(Number.isFinite(result.velocity.y)).toBe(true);
    expect(Number.isFinite(result.velocity.z)).toBe(true);
    expect(result.flightTime).toBeGreaterThan(0);
  });

  it('maintains the launch direction toward the target', () => {
    const start = { x: -3, y: 1, z: 2 };
    const target = { x: 5, y: 3, z: -4 };
    const result = solveBallisticLaunch(start, target, 19.6, 1);
    const dx = target.x - start.x;
    const dz = target.z - start.z;
    const horizontalAngle = Math.atan2(result.velocity.x, result.velocity.z);
    expect(Math.cos(horizontalAngle) * dz + Math.sin(horizontalAngle) * dx).toBeGreaterThan(0);
  });
});