/**
 * physics/physicsOptions.ts — Pure validation and sanitization helpers for
 * body creation and query arguments. Everything here is side-effect free so
 * it can be unit-tested without a Havok world.
 *
 * Rationale: Havok's WASM bindings do not defend against NaN/Infinity or
 * degenerate extents — a single bad value can poison the whole simulation
 * (bodies at NaN positions drag everything they touch into NaN). All inputs
 * crossing into the physics world are sanitized here first.
 */
import { Quaternion, Vector3 } from '@babylonjs/core';

/** Smallest box extent Havok accepts without producing a degenerate shape. */
export const MIN_BOX_EXTENT = 0.001;
/** Extent used when a caller passes a non-finite size component (1m: visible, debuggable). */
export const FALLBACK_BOX_EXTENT = 1;
/** Mass floor for dynamic bodies; Havok misbehaves with mass <= 0 on DYNAMIC bodies. */
export const MIN_DYNAMIC_MASS = 0.001;
/** Fallback mass when a caller passes NaN/Infinity. */
export const DEFAULT_DYNAMIC_MASS = 1;
/** Smallest teleportable bounding radius accepted by the portal scan. */
export const MIN_TELEPORT_RADIUS = 0.001;

/**
 * Neutral material defaults used only when options omit a value. Gameplay
 * tuning (cube damping, panel friction, …) always arrives via options sourced
 * from core/Config.ts — these are physics-plausible zeroes, not game feel.
 */
export const DEFAULT_FRICTION = 0.5;
export const DEFAULT_RESTITUTION = 0;
export const DEFAULT_LINEAR_DAMPING = 0;
export const DEFAULT_ANGULAR_DAMPING = 0;

export function isFiniteVector3(v: Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function isFiniteQuaternion(q: Quaternion): boolean {
  return (
    Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w)
  );
}

function sanitizeExtent(value: number): number {
  if (!Number.isFinite(value)) return FALLBACK_BOX_EXTENT;
  // abs(): a negative extent is almost certainly a sign bug, not intent.
  return Math.max(Math.abs(value), MIN_BOX_EXTENT);
}

/** Clamp a size vector to something Havok can build a valid box from. */
export function sanitizeBoxSize(size: Vector3): Vector3 {
  return new Vector3(sanitizeExtent(size.x), sanitizeExtent(size.y), sanitizeExtent(size.z));
}

/** Clamp a dynamic mass into the range Havok simulates stably. */
export function sanitizeMass(mass: number): number {
  if (!Number.isFinite(mass)) return DEFAULT_DYNAMIC_MASS;
  return Math.max(mass, MIN_DYNAMIC_MASS);
}

/** Non-negative scalar option (damping, friction, restitution) with fallback. */
export function sanitizeNonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

/**
 * Validate an optional rotation. Returns null when the caller supplied
 * nothing usable — the body then keeps the node's existing orientation.
 * A zero-length quaternion is invalid (it normalizes to NaN).
 */
export function sanitizeRotation(rotation: Quaternion | undefined): Quaternion | null {
  if (rotation === undefined) return null;
  if (!isFiniteQuaternion(rotation)) return null;
  if (rotation.lengthSquared() < 1e-12) return null;
  return rotation;
}

/** Portal crossing checks divide by radius in places; keep it positive and finite. */
export function sanitizeTeleportRadius(radius: number): number {
  if (!Number.isFinite(radius) || radius <= 0) return MIN_TELEPORT_RADIUS;
  return radius;
}

/**
 * Allocate a unique body handle from a caller-supplied id. The id is used
 * verbatim as the handle when free (handles stay human-readable in logs);
 * collisions get a `#n` suffix. Empty/blank ids fall back to a generic base.
 */
export function allocateHandle(id: string, isTaken: (handle: string) => boolean): string {
  const base = id.trim().length > 0 ? id : 'body';
  if (!isTaken(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}#${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
}
