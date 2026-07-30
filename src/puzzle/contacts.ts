/**
 * puzzle/contacts.ts — Pure spatial checks used by buttons, lasers, goo, etc.
 */
import type { Vec3 } from '../core/types';

function sq(v: number): number {
  return v * v;
}

/** True when a point lies within an axis-aligned box. */
export function pointInAABB(
  point: Vec3,
  center: Vec3,
  halfExtents: Vec3,
): boolean {
  return (
    Math.abs(point.x - center.x) <= halfExtents.x + 1e-6 &&
    Math.abs(point.y - center.y) <= halfExtents.y + 1e-6 &&
    Math.abs(point.z - center.z) <= halfExtents.z + 1e-6
  );
}

/** True when a point lies within a horizontal (xz) circle at `y`. */
export function pointInCircle(
  point: Vec3,
  center: Vec3,
  radius: number,
  yTolerance = 0.4,
): boolean {
  return (
    Math.abs(point.y - center.y) <= yTolerance + 1e-6 &&
    Math.hypot(point.x - center.x, point.z - center.z) <= radius + 1e-6
  );
}

/** Squared distance from a point to a line segment. */
export function pointToSegmentDistanceSquared(
  a: Vec3,
  b: Vec3,
  point: Vec3,
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const apz = point.z - a.z;

  const abLengthSq = sq(abx) + sq(aby) + sq(abz);
  if (abLengthSq < 1e-12) {
    return sq(apx) + sq(apy) + sq(apz);
  }

  let t = (apx * abx + apy * aby + apz * abz) / abLengthSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = a.x + abx * t;
  const closestY = a.y + aby * t;
  const closestZ = a.z + abz * t;

  return sq(point.x - closestX) + sq(point.y - closestY) + sq(point.z - closestZ);
}

/**
 * Closest distance from a point to an axis-aligned infinite cylinder whose axis
 * is the world Y axis.
 */
export function pointToVerticalCylinder(
  point: Vec3,
  axisCenter: Vec3,
  radius: number,
): number {
  return Math.hypot(point.x - axisCenter.x, point.z - axisCenter.z) - radius;
}

/** True when a circle (xz) overlaps a horizontal rectangle. */
export function circleIntersectsRectangle(
  circleCenter: Vec3,
  radius: number,
  rectCenter: Vec3,
  halfWidth: number,
  halfDepth: number,
): boolean {
  const dx = Math.max(
    0,
    Math.abs(circleCenter.x - rectCenter.x) - halfWidth,
  );
  const dz = Math.max(
    0,
    Math.abs(circleCenter.z - rectCenter.z) - halfDepth,
  );
  return dx * dx + dz * dz <= sq(radius) + 1e-6;
}
