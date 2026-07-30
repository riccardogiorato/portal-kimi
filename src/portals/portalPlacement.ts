/**
 * portals/portalPlacement.ts — Pure placement/cooldown logic.
 *
 * Everything here is side-effect free and unit-tested; PortalSystem wires it
 * to Babylon objects. Vector inputs are read-only.
 */
import { Matrix, Vector3 } from '@babylonjs/core';
import { isWithinPortalBounds, portalPairTransform, signedDistanceToPortalPlane, type PortalFrame } from '../core/math';

export interface SurfaceFacts {
  /** metadata.portalable === true on the hit mesh. */
  portalable: boolean;
  /** metadata.glass === true (lasers pass, portals never stick). */
  isGlass: boolean;
  /** Contiguous run dimensions from metadata.panelSize (meters). */
  runWidth: number;
  runHeight: number;
  /** cos(angle between -rayDirection and surfaceNormal): 1 = head-on. */
  incidenceCos: number;
  /**
   * True for floor/ceiling-like surfaces (|normal.y| large). Wall portals are
   * always upright (run must clear width AND height); floor portals rotate
   * freely (run dimensions may swap).
   */
  isFloorLike: boolean;
}

export interface PlacementRules {
  minSurfaceWidth: number;
  minSurfaceHeight: number;
  /** Reject shots arriving shallower than this many degrees from the surface. */
  minIncidenceDegrees: number;
}

export type PlacementFailure =
  | 'not-portalable'
  | 'glass'
  | 'surface-too-small'
  | 'grazing-angle';

export interface PlacementResult {
  ok: boolean;
  reason?: PlacementFailure;
}

export function validatePortalSurface(facts: SurfaceFacts, rules: PlacementRules): PlacementResult {
  if (facts.isGlass) return { ok: false, reason: 'glass' };
  if (!facts.portalable) return { ok: false, reason: 'not-portalable' };
  if (facts.isFloorLike) {
    // Free orientation: the ellipse's axes may map to either run axis.
    const runMin = Math.min(facts.runWidth, facts.runHeight);
    const runMax = Math.max(facts.runWidth, facts.runHeight);
    const needMin = Math.min(rules.minSurfaceWidth, rules.minSurfaceHeight);
    const needMax = Math.max(rules.minSurfaceWidth, rules.minSurfaceHeight);
    if (runMin < needMin || runMax < needMax) return { ok: false, reason: 'surface-too-small' };
  } else {
    // Upright wall portal: width and height must each clear the ellipse axes.
    if (facts.runWidth < rules.minSurfaceWidth || facts.runHeight < rules.minSurfaceHeight) {
      return { ok: false, reason: 'surface-too-small' };
    }
  }
  const minCos = Math.cos((Math.PI / 2) - (rules.minIncidenceDegrees * Math.PI) / 180);
  if (facts.incidenceCos < minCos) return { ok: false, reason: 'grazing-angle' };
  return { ok: true };
}

/** Fire-rate limiter. */
export class FireCooldown {
  private lastFireTime = -Infinity;

  constructor(private readonly cooldownSeconds: number) {}

  canFire(nowSeconds: number): boolean {
    return nowSeconds - this.lastFireTime >= this.cooldownSeconds;
  }

  recordFire(nowSeconds: number): void {
    this.lastFireTime = nowSeconds;
  }

  reset(): void {
    this.lastFireTime = -Infinity;
  }
}

/**
 * Per-entity teleport cooldowns — stops oscillation when something rests
 * astride a portal plane. Entries are pruned lazily on access.
 */
export class TeleportCooldowns {
  private readonly lastTeleport = new Map<string, number>();

  constructor(private readonly cooldownSeconds: number) {}

  canTeleport(entityId: string, nowSeconds: number): boolean {
    const last = this.lastTeleport.get(entityId);
    if (last === undefined) return true;
    if (nowSeconds - last >= this.cooldownSeconds) return true;
    return false;
  }

  recordTeleport(entityId: string, nowSeconds: number): void {
    this.lastTeleport.set(entityId, nowSeconds);
    // Cheap amortized prune: cap the map so dead entities don't accumulate.
    if (this.lastTeleport.size > 256) {
      for (const [id, t] of this.lastTeleport) {
        if (nowSeconds - t >= this.cooldownSeconds) this.lastTeleport.delete(id);
      }
    }
  }

  clear(): void {
    this.lastTeleport.clear();
  }
}

/**
 * Analytic ray ↔ portal-opening intersection. Returns the ray parameter t of
 * the crossing, or null. Used to route portal SHOTS through open portals
 * (portal surfaces have no physics bodies, so physics raycasts can't see them).
 */
export function rayPortalCrossing(
  origin: Vector3,
  direction: Vector3,
  frame: PortalFrame,
  halfWidth: number,
  halfHeight: number,
  maxT: number,
): number | null {
  const denom = Vector3.Dot(direction, frame.normal);
  if (Math.abs(denom) < 1e-8) return null;
  const t = Vector3.Dot(frame.position.subtract(origin), frame.normal) / denom;
  if (t < 1e-4 || t > maxT) return null;
  const point = origin.add(direction.scale(t));
  return isWithinPortalBounds(point, frame, halfWidth, halfHeight) ? t : null;
}

/**
 * Move a ray through a portal pair: returns the ray exiting the target
 * portal. The origin is first advanced onto the SOURCE plane along the ray —
 * the pair transform maps front-of-source to BEHIND target (it exists for
 * virtual cameras), so without projection the continued ray would start
 * inside the target's wall. The exit is then nudged along the target normal
 * (out of the wall) to avoid self-hits.
 */
export function transformRayThroughPortal(
  origin: Vector3,
  direction: Vector3,
  source: PortalFrame,
  target: PortalFrame,
  exitNudge: number,
  outOrigin: Vector3,
  outDirection: Vector3,
): void {
  const pair: Matrix = portalPairTransform(source, target);
  // Distance along the ray to the source plane (0 when already behind it).
  const dist = signedDistanceToPortalPlane(origin, source);
  const towardPlane = -Vector3.Dot(direction, source.normal);
  const t = dist > 0 && towardPlane > 1e-6 ? dist / towardPlane : 0;
  const planePoint = origin.add(direction.scale(t));
  Vector3.TransformCoordinatesToRef(planePoint, pair, outOrigin);
  Vector3.TransformNormalToRef(direction, pair, outDirection);
  outDirection.normalize();
  outOrigin.addInPlace(target.normal.scale(exitNudge));
}
