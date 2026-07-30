/**
 * portals/portals.test.ts — Pure placement/cooldown/ray-hop logic.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { FireCooldown, TeleportCooldowns, transformRayThroughPortal, validatePortalSurface } from './portalPlacement';
import {
  crossedPortalThisFrame,
  crossedPortalThisFrameFast,
  isWithinPortalBounds,
  isWithinPortalBoundsFast,
  signedDistanceToPortalPlane,
  signedDistanceToPortalPlaneFast,
  type PortalFrame,
} from '../core/math';

const RULES = { minSurfaceWidth: 1.35, minSurfaceHeight: 2.25, minIncidenceDegrees: 15 };

describe('validatePortalSurface', () => {
  const good = { portalable: true, isGlass: false, runWidth: 4, runHeight: 4, incidenceCos: 1, isFloorLike: false };

  it('accepts a head-on shot at a big portalable run', () => {
    expect(validatePortalSurface(good, RULES).ok).toBe(true);
  });

  it('rejects non-portalable surfaces', () => {
    const r = validatePortalSurface({ ...good, portalable: false }, RULES);
    expect(r).toEqual({ ok: false, reason: 'not-portalable' });
  });

  it('rejects glass even when tagged portalable', () => {
    const r = validatePortalSurface({ ...good, isGlass: true }, RULES);
    expect(r).toEqual({ ok: false, reason: 'glass' });
  });

  it('rejects runs too small in either dimension', () => {
    expect(validatePortalSurface({ ...good, runWidth: 1.0, runHeight: 4 }, RULES).reason).toBe('surface-too-small');
    expect(validatePortalSurface({ ...good, runWidth: 4, runHeight: 2.0 }, RULES).reason).toBe('surface-too-small');
  });

  it('accepts a rotated run on floor-like surfaces (axes may swap)', () => {
    expect(validatePortalSurface({ ...good, isFloorLike: true, runWidth: 2.3, runHeight: 1.4 }, RULES).ok).toBe(true);
  });

  it('rejects a short wall run even when wide (upright portals)', () => {
    expect(validatePortalSurface({ ...good, runWidth: 4, runHeight: 2.0 }, RULES).reason).toBe('surface-too-small');
  });

  it('rejects grazing shots', () => {
    // 10° from the surface plane → below the 15° minimum incidence.
    const cos10 = Math.cos((80 * Math.PI) / 180);
    expect(validatePortalSurface({ ...good, incidenceCos: cos10 }, RULES).reason).toBe('grazing-angle');
  });

  it('accepts exactly at the incidence boundary', () => {
    const cos15 = Math.cos((75 * Math.PI) / 180);
    expect(validatePortalSurface({ ...good, incidenceCos: cos15 + 1e-9 }, RULES).ok).toBe(true);
  });
});

describe('FireCooldown', () => {
  it('gates firing by elapsed time', () => {
    const cd = new FireCooldown(0.3);
    expect(cd.canFire(0)).toBe(true);
    cd.recordFire(1.0);
    expect(cd.canFire(1.1)).toBe(false);
    expect(cd.canFire(1.29)).toBe(false);
    expect(cd.canFire(1.3)).toBe(true);
  });

  it('reset re-arms immediately', () => {
    const cd = new FireCooldown(0.3);
    cd.recordFire(5);
    cd.reset();
    expect(cd.canFire(5.01)).toBe(true);
  });
});

describe('TeleportCooldowns', () => {
  it('blocks re-teleport inside the window, allows after', () => {
    const cds = new TeleportCooldowns(0.08);
    expect(cds.canTeleport('player', 10)).toBe(true);
    cds.recordTeleport('player', 10);
    expect(cds.canTeleport('player', 10.05)).toBe(false);
    expect(cds.canTeleport('player', 10.09)).toBe(true);
  });

  it('tracks entities independently', () => {
    const cds = new TeleportCooldowns(0.08);
    cds.recordTeleport('a', 1);
    expect(cds.canTeleport('b', 1.01)).toBe(true);
  });
});

describe('transformRayThroughPortal', () => {
  const wallA: PortalFrame = { position: new Vector3(0, 1.1, 5), normal: new Vector3(0, 0, -1), up: new Vector3(0, 1, 0) };
  const wallB: PortalFrame = { position: new Vector3(10, 1.1, 0), normal: new Vector3(-1, 0, 0), up: new Vector3(0, 1, 0) };

  it('moves the ray origin to the exit portal and preserves ray speed direction through the pair', () => {
    const outO = Vector3.Zero();
    const outD = Vector3.Zero();
    // Ray hits A head-on traveling +Z.
    transformRayThroughPortal(new Vector3(0, 1.1, 4.9), new Vector3(0, 0, 1), wallA, wallB, 0.06, outO, outD);
    // Exits near B, nudged along B's normal (-X).
    expect(outO.x).toBeCloseTo(10 - 0.06, 3);
    expect(outO.y).toBeCloseTo(1.1, 3);
    // Direction now points out of B: -X.
    expect(outD.x).toBeCloseTo(-1, 3);
    expect(outD.length()).toBeCloseTo(1, 5);
  });

  it('preserves lateral offset through the pair', () => {
    const outO = Vector3.Zero();
    const outD = Vector3.Zero();
    // Hit A 0.5m to the LEFT of center (world -X when facing -Z... A's local X).
    transformRayThroughPortal(new Vector3(0.5, 1.1, 4.9), new Vector3(0, 0, 1), wallA, wallB, 0, outO, outD);
    // The 180° flip in the pair transform mirrors the offset: exits 0.5m on the mirrored side of B.
    expect(Math.abs(outO.z)).toBeCloseTo(0.5, 3);
  });
});

describe('fast (allocation-free) portal math variants match the reference implementations', () => {
  const frames: PortalFrame[] = [
    { position: new Vector3(0, 1.1, 5), normal: new Vector3(0, 0, -1), up: new Vector3(0, 1, 0) },
    { position: new Vector3(3, 0, -2), normal: new Vector3(0, 1, 0), up: new Vector3(0, 0, 1) }, // floor
    { position: new Vector3(-4, 1.5, 1), normal: new Vector3(0.6, 0, 0.8).normalize(), up: new Vector3(0, 1, 0) }, // angled
  ];
  const probes = [
    new Vector3(0, 1.1, 4.9),
    new Vector3(0.6, 2.0, 5.1),
    new Vector3(3.1, 0.05, -2.2),
    new Vector3(-3.5, 1.4, 1.3),
    new Vector3(10, 10, 10),
  ];

  it('signedDistance matches', () => {
    for (const frame of frames) {
      for (const p of probes) {
        expect(signedDistanceToPortalPlaneFast(p, frame)).toBeCloseTo(signedDistanceToPortalPlane(p, frame), 6);
      }
    }
  });

  it('bounds checks match', () => {
    for (const frame of frames) {
      for (const p of probes) {
        expect(isWithinPortalBoundsFast(p, frame, 0.65, 1.1)).toBe(isWithinPortalBounds(p, frame, 0.65, 1.1));
      }
    }
  });

  it('crossing detection matches', () => {
    const targets = [new Vector3(0, 1.1, 5.2), new Vector3(3, -0.3, -2), new Vector3(8, 8, 8)];
    for (const frame of frames) {
      for (const a of probes) {
        for (const b of targets) {
          expect(crossedPortalThisFrameFast(a, b, frame, 0.65, 1.1)).toBe(crossedPortalThisFrame(a, b, frame, 0.65, 1.1));
        }
      }
    }
  });
});
