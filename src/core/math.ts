/**
 * core/math.ts — Pure math shared by portals, player and tests.
 *
 * The portal pair transform is the heart of the game:
 *
 *     M = B_world · FlipY(π) · inverse(A_world)
 *
 * Applying M to any pose near portal A yields the equivalent pose exiting
 * portal B. The same matrix drives the virtual RTT camera, player
 * teleportation and object teleportation, so it is defined exactly once here.
 */
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';

/** A portal's world placement: position on the wall, normal pointing OUT of the wall. */
export interface PortalFrame {
  position: Vector3;
  normal: Vector3;
  /** Up vector used to orient the portal ellipse (world-up projected for walls). */
  up: Vector3;
}

/** Build the world matrix of a portal frame. +Z of the matrix == portal normal. */
export function portalFrameToMatrix(frame: PortalFrame): Matrix {
  const zAxis = frame.normal.normalizeToNew();
  const xAxis = Vector3.Cross(frame.up, zAxis);
  if (xAxis.lengthSquared() < 1e-8) {
    // Normal parallel to up (floor/ceiling portal): pick an arbitrary stable up.
    const fallbackUp = Math.abs(zAxis.y) > 0.99 ? new Vector3(0, 0, zAxis.y > 0 ? -1 : 1) : Vector3.Up();
    return portalFrameToMatrix({ ...frame, up: fallbackUp });
  }
  xAxis.normalize();
  const yAxis = Vector3.Cross(zAxis, xAxis);
  const matrix = Matrix.FromValues(
    xAxis.x, xAxis.y, xAxis.z, 0,
    yAxis.x, yAxis.y, yAxis.z, 0,
    zAxis.x, zAxis.y, zAxis.z, 0,
    frame.position.x, frame.position.y, frame.position.z, 1,
  );
  return matrix;
}

const FLIP_Y_PI = Matrix.RotationY(Math.PI);

/**
 * Transform mapping poses from portal `source`'s frame to portal `target`'s
 * frame, including the 180° yaw that makes you face OUT of the exit portal.
 */
export function portalPairTransform(source: PortalFrame, target: PortalFrame): Matrix {
  const sourceWorld = portalFrameToMatrix(source);
  const targetWorld = portalFrameToMatrix(target);
  const sourceInverse = sourceWorld.clone();
  sourceInverse.invert();
  // Babylon uses row vectors (v·M): matrices apply left-to-right, so the
  // source inverse must come FIRST in the multiplication chain.
  return sourceInverse.multiply(FLIP_Y_PI).multiply(targetWorld);
}

/** Rotate a direction/velocity vector by a portal pair transform. */
export function transformDirectionThroughPortal(direction: Vector3, pairTransform: Matrix): Vector3 {
  return Vector3.TransformNormal(direction, pairTransform);
}

/** Signed distance from a point to the portal plane (positive = in front of the normal). */
export function signedDistanceToPortalPlane(point: Vector3, frame: PortalFrame): number {
  return Vector3.Dot(point.subtract(frame.position), frame.normal);
}

/**
 * True when a point (projected onto the portal plane) lies inside the portal
 * ellipse. halfWidth/halfHeight are the ellipse semi-axes.
 */
export function isWithinPortalBounds(
  point: Vector3,
  frame: PortalFrame,
  halfWidth: number,
  halfHeight: number,
): boolean {
  const local = point.subtract(frame.position);
  const zAxis = frame.normal;
  const xAxis = Vector3.Cross(frame.up, zAxis).normalizeToNew();
  const yAxis = Vector3.Cross(zAxis, xAxis);
  const u = Vector3.Dot(local, xAxis) / halfWidth;
  const v = Vector3.Dot(local, yAxis) / halfHeight;
  return u * u + v * v <= 1;
}

/**
 * Crossing test: the entity moved from in front of the plane to behind it
 * (or vice versa) this frame, within the portal opening. Direction-agnostic
 * so flinging back and forth through a floor portal works.
 */
export function crossedPortalThisFrame(
  previousPosition: Vector3,
  currentPosition: Vector3,
  frame: PortalFrame,
  halfWidth: number,
  halfHeight: number,
): boolean {
  const prevDist = signedDistanceToPortalPlane(previousPosition, frame);
  const currDist = signedDistanceToPortalPlane(currentPosition, frame);
  if (prevDist === 0 || currDist === 0) return false;
  if (Math.sign(prevDist) === Math.sign(currDist)) return false;
  // Test the segment midpoint projected on the plane, robust for fast motion.
  const t = prevDist / (prevDist - currDist);
  const crossingPoint = previousPosition.add(currentPosition.subtract(previousPosition).scale(t));
  return isWithinPortalBounds(crossingPoint, frame, halfWidth, halfHeight);
}

/**
 * Oblique near-plane clipping (Terdiman / Lengyel). Rewrites `projection` so
 * the near plane becomes `clipPlane` (in view space). Geometry behind the
 * exit portal is clipped away instead of leaking into the RTT.
 */
export function makeObliqueProjection(projection: Matrix, clipPlane: { x: number; y: number; z: number; w: number }): Matrix {
  const m = projection.m;
  const q = {
    x: (Math.sign(clipPlane.x) + m[8]) / m[0],
    y: (Math.sign(clipPlane.y) + m[9]) / m[5],
    z: -1.0,
    w: (1.0 + m[10]) / m[14],
  };
  const dot = clipPlane.x * q.x + clipPlane.y * q.y + clipPlane.z * q.z + clipPlane.w * q.w;
  const scale = 2.0 / dot;
  // Matrix.m is immutable in Babylon 9: rebuild with the THIRD ROW replaced
  // (Babylon stores row-major: m[8..11] is the row the oblique trick rewrites).
  return Matrix.FromValues(
    m[0], m[1], m[2], m[3],
    m[4], m[5], m[6], m[7],
    clipPlane.x * scale, clipPlane.y * scale, clipPlane.z * scale + 1.0, clipPlane.w * scale,
    m[12], m[13], m[14], m[15],
  );
}

/** Framerate-independent exponential smoothing (Freya Holmér's damp). */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

export function dampVector3(current: Vector3, target: Vector3, lambda: number, dt: number): Vector3 {
  const k = Math.exp(-lambda * dt);
  return target.add(current.subtract(target).scale(k));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest-path angle lerp in radians. */
export function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

/** Quaternion from yaw/pitch (radians), Y-up, right-handed (Babylon convention). */
export function quaternionFromYawPitch(yaw: number, pitch: number): Quaternion {
  return Quaternion.RotationYawPitchRoll(yaw, pitch, 0);
}

/** Extract yaw (rotation about +Y) from a quaternion. */
export function yawFromQuaternion(q: Quaternion): number {
  const forward = new Vector3(0, 0, 1).rotateByQuaternionToRef(q, new Vector3());
  return Math.atan2(forward.x, forward.z);
}
