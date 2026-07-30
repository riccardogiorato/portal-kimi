/**
 * player/movementMath.ts — Pure movement/camera math for the FPS controller.
 *
 * Everything here is allocation-light (out-params) and side-effect free so it
 * can be unit-tested without a scene. Conventions: meters/seconds/radians,
 * Y-up left-handed (Babylon), yaw=0 faces +Z, positive pitch looks DOWN
 * (Babylon camera rotation.x convention).
 */
import { Vector3 } from '@babylonjs/core';
import { clamp } from '../core/math';

// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------

/** Reusable yaw/pitch holder so look updates allocate nothing per frame. */
export interface LookAngles {
  yaw: number;
  pitch: number;
}

/** Mutates `result` (no allocation); returns it for convenience. */
export function applyLookDelta(
  result: LookAngles,
  yaw: number,
  pitch: number,
  dxPixels: number,
  dyPixels: number,
  radiansPerPixel: number,
  invertY: boolean,
  pitchLimitRadians: number,
): LookAngles {
  result.yaw = yaw + dxPixels * radiansPerPixel;
  const pitchDelta = dyPixels * radiansPerPixel * (invertY ? 1 : -1);
  result.pitch = clamp(pitch + pitchDelta, -pitchLimitRadians, pitchLimitRadians);
  return result;
}

// ---------------------------------------------------------------------------
// Wish direction (input axes → world-space XZ direction)
// ---------------------------------------------------------------------------

/** forward/right are -1..1 input axes (W=+1 forward, D=+1 right). */
export function computeWishDirection(yaw: number, forward: number, right: number, out: Vector3): Vector3 {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // forward = (sinY, 0, cosY); right = cross(up, forward) = (cosY, 0, -sinY)
  out.set(sin * forward + cos * right, 0, cos * forward - sin * right);
  const lenSq = out.lengthSquared();
  if (lenSq > 1e-10) out.scaleInPlace(1 / Math.sqrt(lenSq));
  return out;
}

// ---------------------------------------------------------------------------
// Acceleration / friction (Quake-flavored, tuned by Config)
// ---------------------------------------------------------------------------

/** Accelerate current velocity toward wishDir·targetSpeed. Mutates velocity. */
export function accelerate(velocity: Vector3, wishDir: Vector3, targetSpeed: number, accel: number, dt: number): void {
  const currentSpeed = Vector3.Dot(velocity, wishDir);
  const addSpeed = targetSpeed - currentSpeed;
  if (addSpeed <= 0) return;
  const accelSpeed = Math.min(accel * dt * targetSpeed, addSpeed);
  // scaleAndAddToRef: result = velocity + wishDir*accelSpeed, in place. No temp vector.
  wishDir.scaleAndAddToRef(accelSpeed, velocity);
}

/** Apply ground friction to the XZ components. Mutates velocity. */
export function applyFriction(velocity: Vector3, friction: number, dt: number): void {
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed < 1e-4) {
    velocity.x = 0;
    velocity.z = 0;
    return;
  }
  const drop = speed * friction * dt;
  const newSpeed = Math.max(0, speed - drop) / speed;
  velocity.x *= newSpeed;
  velocity.z *= newSpeed;
}

// ---------------------------------------------------------------------------
// Jump: coyote time + input buffer
// ---------------------------------------------------------------------------

export class JumpController {
  private coyoteTimer = 0;
  private bufferTimer = 0;

  constructor(
    private readonly coyoteSeconds = 0.12,
    private readonly bufferSeconds = 0.15,
  ) {}

  /** Returns true exactly once per consumable jump. */
  update(dt: number, grounded: boolean, jumpPressed: boolean): boolean {
    this.coyoteTimer = grounded ? this.coyoteSeconds : Math.max(0, this.coyoteTimer - dt);
    if (jumpPressed) this.bufferTimer = this.bufferSeconds;
    else this.bufferTimer = Math.max(0, this.bufferTimer - dt);

    if (this.bufferTimer > 0 && this.coyoteTimer > 0) {
      this.bufferTimer = 0;
      this.coyoteTimer = 0;
      return true;
    }
    return false;
  }

  reset(): void {
    this.coyoteTimer = 0;
    this.bufferTimer = 0;
  }
}

// ---------------------------------------------------------------------------
// Head bob + footsteps
// ---------------------------------------------------------------------------

/** Advance the bob phase; rate scales with horizontal speed. */
export function advanceBobPhase(phase: number, horizontalSpeed: number, dt: number, frequency: number): number {
  return phase + dt * frequency * clamp(horizontalSpeed / 4.6, 0, 1.6);
}

/** Camera-local bob offset for a phase. Two footfalls per 2π cycle. */
export function bobOffset(phase: number, amplitude: number, out: Vector3): void {
  out.set(Math.sin(phase) * amplitude * 0.6, Math.sin(phase * 2) * amplitude * 0.5, 0);
}

/** True when the phase crossed a π boundary this frame (footfall moment). */
export function crossedStepBoundary(previousPhase: number, currentPhase: number): boolean {
  return Math.floor(previousPhase / Math.PI) !== Math.floor(currentPhase / Math.PI);
}

// ---------------------------------------------------------------------------
// FOV + landing feel
// ---------------------------------------------------------------------------

export function targetFovRadians(baseFovRadians: number, sprinting: boolean, sprintKickRadians: number): number {
  return sprinting ? baseFovRadians + sprintKickRadians : baseFovRadians;
}

/** 0 below threshold; grows linearly above it, capped at 1. */
export function landingKickAmount(impactSpeed: number, threshold: number): number {
  if (impactSpeed < threshold) return 0;
  return clamp((impactSpeed - threshold) / threshold, 0, 1);
}

// ---------------------------------------------------------------------------
// Portal teleport orientation
// ---------------------------------------------------------------------------

/**
 * Inverse of the Babylon yaw/pitch convention: forward =
 * (cosP·sinY, −sinP, cosP·cosY). Input need not be normalized.
 */
export function yawPitchFromForward(forward: Vector3): { yaw: number; pitch: number } {
  const f = forward.normalizeToNew();
  return {
    yaw: Math.atan2(f.x, f.z),
    pitch: -Math.asin(clamp(f.y, -1, 1)),
  };
}

// ---------------------------------------------------------------------------
// Carry solver
// ---------------------------------------------------------------------------

/** Velocity that pulls an object toward the hold point, clamped to maxSpeed. */
export function carryVelocity(holdPoint: Vector3, objectPosition: Vector3, lerpRate: number, maxSpeed: number, out: Vector3): Vector3 {
  holdPoint.subtractToRef(objectPosition, out);
  out.scaleInPlace(lerpRate);
  const speedSq = out.lengthSquared();
  if (speedSq > maxSpeed * maxSpeed) out.scaleInPlace(maxSpeed / Math.sqrt(speedSq));
  return out;
}
