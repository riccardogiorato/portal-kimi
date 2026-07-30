/**
 * puzzle/ballistic.ts — Pure trajectory solver for faith plates and tests.
 */
import type { Vec3 } from '../core/types';

interface BallisticResult {
  velocity: Vec3;
  flightTime: number;
  scaledBy: number;
}

/**
 * Solve an initial velocity so a projectile starting at `start` lands at `target`
 * under the given gravity magnitude.  The returned velocity points along the
 * higher (steeper) of the two valid launch angles and is then scaled by `power`.
 */
export function solveBallisticLaunch(
  start: Vec3,
  target: Vec3,
  gravity: number,
  power = 1,
): BallisticResult {
  const dx = target.x - start.x;
  const dz = target.z - start.z;
  const h = target.y - start.y;
  const distance = Math.hypot(dx, dz);

  const g = Math.max(0.0001, gravity);
  const defaultSpeed = Math.sqrt(g * Math.max(distance, 0.0001));
  const attemptedSpeed = defaultSpeed * Math.max(0.001, power);

  let speed = attemptedSpeed;

  // If the point is not reachable at the requested power, gradually raise speed
  // until a real solution exists.
  for (let i = 0; i < 12; i++) {
    const disc = distance * distance - 4 * ((g * distance * distance) / (2 * speed * speed)) * (h + (g * distance * distance) / (2 * speed * speed));
    if (disc >= 0) break;
    speed *= 1.2;
  }

  const a = (g * distance * distance) / (2 * speed * speed);
  const c = h + a;

  let tan: number;
  const denom = 2 * a;
  if (Math.abs(denom) < 1e-12) {
    // Vertically aligned target.
    tan = (h / distance) * 10;
  } else {
    const disc = distance * distance - 4 * a * c;
    const sqrtDisc = Math.sqrt(Math.max(0, disc));
    // Pick the steeper launch angle.
    tan = (distance + sqrtDisc) / denom;
  }

  const cos = 1 / Math.sqrt(1 + tan * tan);
  const sin = tan * cos;

  const dirX = distance > 0.0001 ? dx / distance : 0;
  const dirZ = distance > 0.0001 ? dz / distance : 0;

  const vHorizontal = speed * cos;
  const vVertical = speed * sin;

  const velocity: Vec3 = {
    x: dirX * vHorizontal,
    y: vVertical,
    z: dirZ * vHorizontal,
  };

  const flightTime = distance > 0.0001 ? distance / vHorizontal : (vVertical !== 0 ? (Math.sqrt(vVertical * vVertical + 2 * g * h) - vVertical) / g : 0);

  return { velocity, flightTime, scaledBy: speed / defaultSpeed };
}
