/**
 * Unit tests for the portal pair transform — the single most important piece
 * of math in the game. If these pass, walking through a portal preserves
 * position, orientation and momentum correctly.
 */
import { describe, expect, it } from 'vitest';
import { Matrix, Quaternion, Vector3, Vector4 } from '@babylonjs/core';
import {
  crossedPortalThisFrame,
  damp,
  isWithinPortalBounds,
  lerpAngle,
  makeObliqueProjection,
  portalPairTransform,
  portalPairTransformToRef,
  signedDistanceToPortalPlane,
  transformDirectionThroughPortal,
  type PortalFrame,
} from './math';

const UP = new Vector3(0, 1, 0);

function expectVectorClose(actual: Vector3, expected: Vector3, epsilon = 1e-4): void {
  expect(actual.x, `x: expected ${expected.x}, got ${actual.x}`).toBeCloseTo(expected.x, 4);
  expect(actual.y, `y: expected ${expected.y}, got ${actual.y}`).toBeCloseTo(expected.y, 4);
  expect(actual.z, `z: expected ${expected.z}, got ${actual.z}`).toBeCloseTo(expected.z, 4);
  void epsilon;
}

describe('portalPairTransform', () => {
  it('maps a pose through portals on opposite walls', () => {
    // Portal A on the west wall (x = -5), facing +X into the room.
    const a: PortalFrame = { position: new Vector3(-5, 1.5, 0), normal: new Vector3(1, 0, 0), up: UP };
    // Portal B on the north wall (z = 5), facing -Z into the room.
    const b: PortalFrame = { position: new Vector3(0, 1.5, 5), normal: new Vector3(0, 0, -1), up: UP };

    const m = portalPairTransform(a, b);

    // VIRTUAL-SPACE SEMANTICS: a point 1m in front of A maps to 1m BEHIND B's
    // plane. When the player crosses A's plane, their virtual self crosses B's
    // plane from behind and emerges into the room — this is what makes both
    // the RTT virtual camera and teleportation work.
    const inFrontOfA = new Vector3(-4, 1.5, 0);
    const exited = Vector3.TransformCoordinates(inFrontOfA, m);
    expectVectorClose(exited, new Vector3(0, 1.5, 6));

    // A point exactly on A's plane maps exactly onto B's plane.
    const onA = Vector3.TransformCoordinates(a.position, m);
    expectVectorClose(onA, b.position);

    // Looking INTO A (west, -X) must map to looking OUT of B (south, -Z).
    const lookingIntoA = new Vector3(-1, 0, 0);
    const out = transformDirectionThroughPortal(lookingIntoA, m);
    expectVectorClose(out.normalizeToNew(), new Vector3(0, 0, -1));
  });

  it('preserves momentum direction (speedy thing goes in, speedy thing comes out)', () => {
    // Floor portal at origin facing up; wall portal facing -Z.
    const floor: PortalFrame = { position: new Vector3(0, 0, 0), normal: new Vector3(0, 1, 0), up: new Vector3(0, 0, -1) };
    const wall: PortalFrame = { position: new Vector3(0, 1.5, 5), normal: new Vector3(0, 0, -1), up: UP };

    const m = portalPairTransform(floor, wall);

    // Falling straight down into the floor portal...
    const falling = new Vector3(0, -10, 0);
    const out = transformDirectionThroughPortal(falling, m);
    // ...must fly horizontally OUT of the wall portal (along its normal, -Z).
    expect(out.length()).toBeCloseTo(10, 4);
    expectVectorClose(out.normalizeToNew(), new Vector3(0, 0, -1));
  });

  it('round-trips: A→B then B→A returns the original point', () => {
    const a: PortalFrame = { position: new Vector3(-5, 1.5, 2), normal: new Vector3(1, 0, 0), up: UP };
    const b: PortalFrame = { position: new Vector3(3, 1.5, 5), normal: new Vector3(0, 0, -1), up: UP };

    const forward = portalPairTransform(a, b);
    const backward = portalPairTransform(b, a);

    const p = new Vector3(-4.2, 2.0, 2.5);
    const roundTripped = Vector3.TransformCoordinates(Vector3.TransformCoordinates(p, forward), backward);
    expectVectorClose(roundTripped, p);
  });

  it('rotates facing direction by the pair transform including the 180° flip', () => {
    // Two portals back to back on the same wall plane, both facing +X.
    const a: PortalFrame = { position: new Vector3(-5, 1.5, 0), normal: new Vector3(1, 0, 0), up: UP };
    const b: PortalFrame = { position: new Vector3(-5, 1.5, 3), normal: new Vector3(1, 0, 0), up: UP };

    const m = portalPairTransform(a, b);
    // Walking INTO A means moving along -normal = (-1,0,0). After the flip you
    // must walk OUT of B along +normal = (1,0,0).
    const walkingIn = new Vector3(-1, 0, 0);
    const out = transformDirectionThroughPortal(walkingIn, m);
    expectVectorClose(out.normalizeToNew(), new Vector3(1, 0, 0));
  });
});

describe('portalPairTransformToRef', () => {
  // Regression: the ToRef variant is what every live path (teleport, RTT
  // virtual camera) actually calls, while tests only covered the allocating
  // variant — a Hadamard-vs-matrix-product bug shipped invisibly. Pin the
  // two to identical results.
  const scenarios: Array<{ name: string; a: PortalFrame; b: PortalFrame }> = [
    {
      name: 'opposite walls (awakening blue→orange)',
      a: { position: new Vector3(0, 1.67, -5.855), normal: new Vector3(0, 0, 1), up: UP },
      b: { position: new Vector3(-2, 1.66, 5.855), normal: new Vector3(0, 0, -1), up: UP },
    },
    {
      name: 'west wall → north wall',
      a: { position: new Vector3(-5, 1.5, 0), normal: new Vector3(1, 0, 0), up: UP },
      b: { position: new Vector3(0, 1.5, 5), normal: new Vector3(0, 0, -1), up: UP },
    },
    {
      name: 'floor → wall (fling)',
      a: { position: new Vector3(0, 0, 0), normal: new Vector3(0, 1, 0), up: new Vector3(0, 0, -1) },
      b: { position: new Vector3(0, 1.5, 5), normal: new Vector3(0, 0, -1), up: UP },
    },
    {
      name: 'same wall, side by side',
      a: { position: new Vector3(-5, 1.5, 0), normal: new Vector3(1, 0, 0), up: UP },
      b: { position: new Vector3(-5, 1.5, 3), normal: new Vector3(1, 0, 0), up: UP },
    },
  ];

  for (const { name, a, b } of scenarios) {
    it(`matches portalPairTransform: ${name}`, () => {
      const expected = portalPairTransform(a, b);
      const actual = Matrix.Identity();
      portalPairTransformToRef(a, b, actual);
      for (let i = 0; i < 16; i++) {
        expect(actual.m[i], `m[${i}]`).toBeCloseTo(expected.m[i], 4);
      }
    });
  }

  it('maps the awakening entry point to the exit strip', () => {
    const blue: PortalFrame = { position: new Vector3(0, 1.67, -5.855), normal: new Vector3(0, 0, 1), up: UP };
    const orange: PortalFrame = { position: new Vector3(-2, 1.66, 5.855), normal: new Vector3(0, 0, -1), up: UP };
    const m = Matrix.Identity();
    portalPairTransformToRef(blue, orange, m);
    const exited = Vector3.TransformCoordinates(new Vector3(0, 1.0, -5.475), m);
    // 0.38m in front of blue maps to 0.38m BEHIND orange's plane (z > 5.855);
    // y drops 1cm because orange's frame sits 1cm lower than blue's.
    expectVectorClose(exited, new Vector3(-2, 0.99, 6.235));
  });
});

describe('makeObliqueProjection', () => {
  // Regression: an earlier version rewrote the third ROW (m[8..11]) instead of
  // the clip-z column, clobbering w and rendering the portal RTT black.
  const proj = Matrix.PerspectiveFovLH(1.31, 1.5, 0.05, 1000);
  // Portal plane 1.655m in front of the virtual camera (camera on negative side).
  const plane = { x: 0, y: 0, z: 1, w: -1.655 };
  const oblique = makeObliqueProjection(proj, plane);

  const ndcZ = (zView: number): number => {
    const clip = Vector4.TransformCoordinates(new Vector3(0, 0, zView), oblique);
    return clip.z / clip.w;
  };

  it('keeps w positive in front of the camera', () => {
    const clip = Vector4.TransformCoordinates(new Vector3(0, 0, 5), oblique);
    expect(clip.w).toBeGreaterThan(0);
  });

  it('moves the near plane to the clip plane', () => {
    expect(ndcZ(1.655)).toBeCloseTo(0, 3);
  });

  it('clips geometry on the camera side of the plane', () => {
    expect(ndcZ(1.0)).toBeLessThan(0);
    expect(ndcZ(0.1)).toBeLessThan(0);
  });

  it('keeps room geometry beyond the plane visible', () => {
    const z = ndcZ(5);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(1);
  });

  it('maps the far plane to ndc 1', () => {
    expect(ndcZ(1000)).toBeCloseTo(1, 2);
  });
});

describe('crossedPortalThisFrame', () => {
  const frame: PortalFrame = { position: new Vector3(0, 1.1, 0), normal: new Vector3(0, 1, 0), up: new Vector3(0, 0, 1) };
  const halfW = 0.65;
  const halfH = 1.1;

  it('detects a fall through a floor portal', () => {
    const prev = new Vector3(0, 1.2, 0);
    const curr = new Vector3(0, 1.0, 0);
    expect(crossedPortalThisFrame(prev, curr, frame, halfW, halfH)).toBe(true);
  });

  it('rejects movement that stays on one side', () => {
    const prev = new Vector3(0, 1.5, 0);
    const curr = new Vector3(0, 1.3, 0);
    expect(crossedPortalThisFrame(prev, curr, frame, halfW, halfH)).toBe(false);
  });

  it('rejects crossings outside the portal ellipse', () => {
    const prev = new Vector3(5, 1.2, 0); // far outside the opening
    const curr = new Vector3(5, 1.0, 0);
    expect(crossedPortalThisFrame(prev, curr, frame, halfW, halfH)).toBe(false);
  });

  it('detects upward crossings (fling back up through a floor portal)', () => {
    const prev = new Vector3(0.2, 0.9, 0.1);
    const curr = new Vector3(0.2, 1.3, 0.1);
    expect(crossedPortalThisFrame(prev, curr, frame, halfW, halfH)).toBe(true);
  });
});

describe('isWithinPortalBounds', () => {
  const frame: PortalFrame = { position: new Vector3(0, 1.1, 0), normal: new Vector3(0, 0, 1), up: UP };

  it('accepts the center', () => {
    expect(isWithinPortalBounds(frame.position, frame, 0.65, 1.1)).toBe(true);
  });

  it('rejects points beyond the horizontal semi-axis', () => {
    const p = frame.position.add(new Vector3(0.7, 0, 0));
    expect(isWithinPortalBounds(p, frame, 0.65, 1.1)).toBe(false);
  });

  it('accepts points just inside the vertical semi-axis', () => {
    const p = frame.position.add(new Vector3(0, 1.0, 0));
    expect(isWithinPortalBounds(p, frame, 0.65, 1.1)).toBe(true);
  });
});

describe('signedDistanceToPortalPlane', () => {
  it('is positive in front of the normal and negative behind', () => {
    const frame: PortalFrame = { position: new Vector3(0, 0, 0), normal: new Vector3(0, 1, 0), up: UP };
    expect(signedDistanceToPortalPlane(new Vector3(0, 2, 0), frame)).toBeCloseTo(2, 5);
    expect(signedDistanceToPortalPlane(new Vector3(0, -3, 0), frame)).toBeCloseTo(-3, 5);
  });
});

describe('smoothing helpers', () => {
  it('damp converges toward the target', () => {
    let value = 0;
    for (let i = 0; i < 120; i++) value = damp(value, 10, 5, 1 / 60);
    expect(value).toBeGreaterThan(9.9);
  });

  it('lerpAngle takes the short way around', () => {
    const result = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
    // Halfway across the ±π seam is ±π, not 0.
    expect(Math.abs(Math.abs(result) - Math.PI)).toBeLessThan(1e-6);
  });
});

describe('quaternion sanity (Babylon interop)', () => {
  it('rotation matrix round-trips through quaternion', () => {
    const q = Quaternion.RotationYawPitchRoll(0.7, -0.2, 0);
    const m = new Matrix();
    q.toRotationMatrix(m);
    const v = new Vector3(1, 2, 3);
    const rotated = Vector3.TransformCoordinates(v, m);
    const rotatedQ = v.rotateByQuaternionToRef(q, new Vector3());
    expectVectorClose(rotated, rotatedQ);
  });
});
