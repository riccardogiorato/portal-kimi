/**
 * player/movementMath.test.ts — Pure-logic coverage for the FPS feel math.
 */
import { describe, expect, it } from 'vitest';
import { Matrix, Vector3 } from '@babylonjs/core';
import { portalPairTransform, type PortalFrame } from '../core/math';
import {
  accelerate,
  advanceBobPhase,
  applyFriction,
  applyLookDelta,
  bobOffset,
  carryVelocity,
  computeWishDirection,
  crossedStepBoundary,
  JumpController,
  landingKickAmount,
  targetFovRadians,
  yawPitchFromForward,
  type LookAngles,
} from './movementMath';

const HALF_PI = Math.PI / 2;

describe('applyLookDelta', () => {
  it('turns right with positive dx, looks down with positive dy (not inverted)', () => {
    const r: LookAngles = { yaw: 0, pitch: 0 };
    applyLookDelta(r, 0, 0, 100, 50, 0.002, false, HALF_PI);
    expect(r.yaw).toBeCloseTo(0.2, 5);
    expect(r.pitch).toBeCloseTo(-0.1, 5);
  });

  it('invertY flips pitch direction', () => {
    const r: LookAngles = { yaw: 0, pitch: 0 };
    applyLookDelta(r, 0, 0, 0, 50, 0.002, true, HALF_PI);
    expect(r.pitch).toBeCloseTo(0.1, 5);
  });

  it('clamps pitch at the limit', () => {
    const r: LookAngles = { yaw: 0, pitch: 1.5 };
    applyLookDelta(r, 0, 1.5, 0, 10000, 0.002, false, 1.55);
    expect(r.pitch).toBe(-1.55);
  });

  it('returns the same result reference (no per-frame allocation)', () => {
    const r: LookAngles = { yaw: 0, pitch: 0 };
    expect(applyLookDelta(r, 0, 0, 10, 0, 0.002, false, HALF_PI)).toBe(r);
  });
});

describe('computeWishDirection', () => {
  it('yaw=0 forward is +Z', () => {
    const out = Vector3.Zero();
    computeWishDirection(0, 1, 0, out);
    expect(out.x).toBeCloseTo(0, 5);
    expect(out.z).toBeCloseTo(1, 5);
  });

  it('yaw=0 strafe right is +X', () => {
    const out = Vector3.Zero();
    computeWishDirection(0, 0, 1, out);
    expect(out.x).toBeCloseTo(1, 5);
    expect(out.z).toBeCloseTo(0, 5);
  });

  it('yaw=90° forward is +X', () => {
    const out = Vector3.Zero();
    computeWishDirection(HALF_PI, 1, 0, out);
    expect(out.x).toBeCloseTo(1, 5);
    expect(out.z).toBeCloseTo(0, 5);
  });

  it('diagonal input is normalized (no faster diagonals)', () => {
    const out = Vector3.Zero();
    computeWishDirection(0.7, 1, 1, out);
    expect(out.length()).toBeCloseTo(1, 5);
  });

  it('zero input gives zero vector', () => {
    const out = Vector3.Zero();
    computeWishDirection(1.2, 0, 0, out);
    expect(out.lengthSquared()).toBe(0);
  });
});

describe('accelerate / applyFriction', () => {
  it('accelerates toward target speed without overshooting', () => {
    const vel = Vector3.Zero();
    const wish = new Vector3(0, 0, 1);
    for (let i = 0; i < 120; i++) accelerate(vel, wish, 4.6, 42, 1 / 60);
    expect(vel.z).toBeCloseTo(4.6, 1);
  });

  it('does not add speed past target along the wish axis', () => {
    const vel = new Vector3(0, 0, 5);
    accelerate(vel, new Vector3(0, 0, 1), 4.6, 42, 1 / 60);
    expect(vel.z).toBe(5);
  });

  it('friction bleeds speed to a stop', () => {
    const vel = new Vector3(3, 0, 0);
    for (let i = 0; i < 300; i++) applyFriction(vel, 11, 1 / 60);
    expect(Math.abs(vel.x)).toBeLessThan(0.01);
  });

  it('friction never reverses direction', () => {
    const vel = new Vector3(0.001, 0, 0);
    applyFriction(vel, 11, 10); // absurd dt
    expect(vel.x).toBeGreaterThanOrEqual(0);
  });
});

describe('JumpController', () => {
  it('fires on press while grounded', () => {
    const j = new JumpController();
    expect(j.update(1 / 60, true, true)).toBe(true);
  });

  it('does not fire twice for one press', () => {
    const j = new JumpController();
    j.update(1 / 60, true, true);
    expect(j.update(1 / 60, false, false)).toBe(false);
  });

  it('coyote window allows a jump shortly after leaving ground', () => {
    const j = new JumpController(0.12, 0.15);
    j.update(1 / 60, true, false); // grounded
    j.update(0.05, false, false); // walked off a ledge
    expect(j.update(0.05, false, true)).toBe(true); // pressed 0.1s later
  });

  it('coyote window expires', () => {
    const j = new JumpController(0.12, 0.15);
    j.update(1 / 60, true, false);
    j.update(0.2, false, false);
    expect(j.update(1 / 60, false, true)).toBe(false);
  });

  it('buffered press fires when landing within the window', () => {
    const j = new JumpController(0.12, 0.15);
    j.update(1 / 60, false, true); // pressed mid-air
    expect(j.update(0.05, true, false)).toBe(true); // landed 0.05s later
  });
});

describe('head bob + footsteps', () => {
  it('phase advances with speed, not when still', () => {
    expect(advanceBobPhase(0, 0, 1, 9.5)).toBe(0);
    expect(advanceBobPhase(0, 4.6, 1, 9.5)).toBeCloseTo(9.5, 3);
  });

  it('bob offset is bounded by amplitude', () => {
    const out = Vector3.Zero();
    for (let p = 0; p < 20; p += 0.37) {
      bobOffset(p, 0.035, out);
      expect(Math.abs(out.x)).toBeLessThanOrEqual(0.035 * 0.6 + 1e-9);
      expect(Math.abs(out.y)).toBeLessThanOrEqual(0.035 * 0.5 + 1e-9);
    }
  });

  it('step boundary fires once per π', () => {
    expect(crossedStepBoundary(0.1, 3.2)).toBe(true);
    expect(crossedStepBoundary(3.2, 3.3)).toBe(false);
    expect(crossedStepBoundary(3.3, 6.4)).toBe(true);
  });
});

describe('fov + landing', () => {
  it('sprint kick applies only while sprinting', () => {
    const base = (75 * Math.PI) / 180;
    const kick = (4 * Math.PI) / 180;
    expect(targetFovRadians(base, false, kick)).toBe(base);
    expect(targetFovRadians(base, true, kick)).toBeCloseTo(base + kick, 10);
  });

  it('landing kick is 0 below threshold and capped at 1', () => {
    expect(landingKickAmount(3, 6)).toBe(0);
    expect(landingKickAmount(6, 6)).toBe(0);
    expect(landingKickAmount(9, 6)).toBeCloseTo(0.5, 5);
    expect(landingKickAmount(60, 6)).toBe(1);
  });
});

describe('yawPitchFromForward', () => {
  it('round-trips through RotationYawPitchRoll', () => {
    const cases = [
      { yaw: 0, pitch: 0 },
      { yaw: 1.1, pitch: -0.4 },
      { yaw: -2.3, pitch: 0.9 },
      { yaw: 3.0, pitch: 0.0 },
    ];
    for (const c of cases) {
      const forward = Vector3.TransformNormal(new Vector3(0, 0, 1), Matrix.RotationYawPitchRoll(c.yaw, c.pitch, 0));
      const r = yawPitchFromForward(forward);
      const roundTrip = Vector3.TransformNormal(new Vector3(0, 0, 1), Matrix.RotationYawPitchRoll(r.yaw, r.pitch, 0));
      expect(roundTrip.x).toBeCloseTo(forward.x, 4);
      expect(roundTrip.y).toBeCloseTo(forward.y, 4);
      expect(roundTrip.z).toBeCloseTo(forward.z, 4);
    }
  });

  it('handles straight up/down without NaN', () => {
    const up = yawPitchFromForward(new Vector3(0, 1, 0));
    const down = yawPitchFromForward(new Vector3(0, -1, 0));
    expect(Number.isFinite(up.yaw)).toBe(true);
    expect(Number.isFinite(down.pitch)).toBe(true);
    expect(up.pitch).toBeCloseTo(-HALF_PI, 4);
    expect(down.pitch).toBeCloseTo(HALF_PI, 4);
  });
});

describe('carryVelocity', () => {
  it('pulls toward the hold point proportionally', () => {
    const out = Vector3.Zero();
    carryVelocity(new Vector3(0, 0, 1.5), new Vector3(0, 0, 1), 14, 12, out);
    expect(out.z).toBeCloseTo(7, 3); // (1.5-1)*14, under the cap
  });

  it('clamps to max speed when far away', () => {
    const out = Vector3.Zero();
    carryVelocity(new Vector3(100, 0, 0), Vector3.Zero(), 14, 12, out);
    expect(out.length()).toBeCloseTo(12, 5);
  });
});

// Regression: PlayerSystem.teleportThroughPortal transforms velocity AND
// facing in place (Vector3.TransformNormalToRef), then rebuilds yaw/pitch
// from the transformed forward. The pair transform is a pure rotation +
// translation, so a unit forward stays unit and speed is preserved.
describe('portal teleport regression (floor → wall)', () => {
  const floor: PortalFrame = { position: new Vector3(0, 0, 0), normal: new Vector3(0, 1, 0), up: new Vector3(0, 0, -1) };
  const wall: PortalFrame = { position: new Vector3(0, 1.5, 5), normal: new Vector3(0, 0, -1), up: new Vector3(0, 1, 0) };
  const m = portalPairTransform(floor, wall);

  it('in-place transform preserves the magnitude (ref returned, no new vector)', () => {
    const fall = new Vector3(0, -10, 0);
    const out = Vector3.TransformNormalToRef(fall, m, fall);
    expect(out).toBe(fall); // same reference — proves the in-place path PlayerSystem relies on
  });

  it('turns downward velocity into horizontal out of the wall portal (momentum conserved)', () => {
    const fall = new Vector3(0, -10, 0);
    Vector3.TransformNormalToRef(fall, m, fall);
    expect(fall.y).toBeCloseTo(0, 4); // no longer falling
    expect(fall.length()).toBeCloseTo(10, 4); // "speedy thing goes in, speedy thing comes out"
    expect(fall.z).toBeLessThan(-9); // flying OUT of the wall portal along -Z
  });

  it('reconstructs a horizontal look direction after the transform', () => {
    // Looking straight down into the floor portal.
    const fwd = new Vector3(0, -1, 0);
    Vector3.TransformNormalToRef(fwd, m, fwd);
    // Comes straight out of the wall portal facing -Z.
    expect(fwd.x).toBeCloseTo(0, 4);
    expect(fwd.y).toBeCloseTo(0, 4);
    expect(fwd.z).toBeCloseTo(-1, 4);
    const { yaw, pitch } = yawPitchFromForward(fwd);
    expect(Math.abs(Math.abs(yaw) - Math.PI)).toBeLessThan(1e-4); // facing -Z
    expect(pitch).toBeCloseTo(0, 4); // level out the other side
  });

  it('a forward lean into the floor maps to a downward exit out of the wall', () => {
    // Slight forward lean while dropping: mostly down, a touch +Z (moving forward over the portal).
    const fwd = new Vector3(0, -Math.cos(0.3), Math.sin(0.3));
    Vector3.TransformNormalToRef(fwd, m, fwd);
    expect(fwd.z).toBeLessThan(-0.8); // still exits -Z
    expect(fwd.y).toBeLessThan(-0.1); // and now angled DOWN out of the wall (lean carried through)
    const { pitch } = yawPitchFromForward(fwd);
    expect(pitch).toBeGreaterThan(0); // positive pitch = looking down, per Babylon convention
  });
});
