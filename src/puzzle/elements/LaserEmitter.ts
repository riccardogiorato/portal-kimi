/**
 * puzzle/elements/LaserEmitter.ts — lethal red laser emitter with one portal hop.
 */
import { MeshBuilder, Matrix, TransformNode, Vector3 } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import type { PuzzleElementSpec } from '../../core/types';
import {
  isWithinPortalBoundsFast,
  portalPairTransformToRef,
  signedDistanceToPortalPlaneFast,
  type PortalFrame,
} from '../../core/math';
import { CONFIG } from '../../core/Config';
import { SOUND } from '../../core/soundIds';
import { BasePuzzleElement } from '../PuzzleElement';
import { PuzzleMaterials } from '../materials';
import type { LaserTarget, PuzzleContext } from '../types';

const LASER_RADIUS = 0.025;
const MAX_DISTANCE = 100;
const PLAYER_KILL_RADIUS = 0.42;
const GLASS_FUDGE = 0.03;
const PORTAL_COLORS = ['blue', 'orange'] as const;

type LaserEmitterSpec = Extract<PuzzleElementSpec, { type: 'laser-emitter' }>;

export class LaserEmitter extends BasePuzzleElement<LaserEmitterSpec> {
  private readonly head: AbstractMesh;
  private readonly beamRoot: TransformNode;
  private readonly beam: AbstractMesh;
  private readonly beamRoot2: TransformNode;
  private readonly beam2: AbstractMesh;
  private readonly direction = Vector3.Zero();
  private readonly nose = Vector3.Zero();
  private readonly segment1End = Vector3.Zero();
  private readonly segment2End = Vector3.Zero();
  private readonly portalEntry = Vector3.Zero();
  private readonly portalOut = Vector3.Zero();
  private readonly portalOutDir = Vector3.Zero();
  private readonly pairTransform = Matrix.Identity();
  private readonly scratchOrigin = Vector3.Zero();
  private readonly scratchHit = Vector3.Zero();
  private readonly scratchEnd = Vector3.Zero();
  private readonly scratchOffset = Vector3.Zero();
  private segment1Length = 0.01;
  private segment2Length = 0.01;
  private hasPortalHop = false;
  private loopId: string | null = null;
  private elapsedSeconds = 0;
  private readonly activeTargets = new Set<LaserTarget>();
  private readonly prevTargets = new Set<LaserTarget>();

  constructor(
    id: string,
    spec: LaserEmitterSpec,
    context: PuzzleContext,
    materials: PuzzleMaterials,
  ) {
    super(id, spec, context, materials);

    const d = spec.direction;
    this.direction.set(d.x, d.y, d.z).normalize();

    const base = MeshBuilder.CreateBox(
      `laser-${id}-base`,
      { width: 0.35, height: 0.45, depth: 0.35 },
      this.scene,
    );
    base.position.y = 0.225;
    base.material = this.ctx.systems.rendering.materials.darkMetal();
    this.track(base);

    this.head = MeshBuilder.CreateCylinder(
      `laser-${id}-head`,
      { height: 0.22, diameter: 0.18, tessellation: 16 },
      this.scene,
    );
    this.head.position.y = 0.45 + 0.11;
    this.head.material = this.ctx.systems.rendering.materials.trimMetal();
    this.track(this.head);
    this.alignHead();

    const beamOptions = {
      height: 1,
      diameterTop: LASER_RADIUS * 2,
      diameterBottom: LASER_RADIUS * 2,
      tessellation: 12,
    };

    this.beamRoot = new TransformNode(`laser-${id}-beamRoot`, this.scene);
    this.beamRoot.position.copyFrom(this.nose);

    this.beam = MeshBuilder.CreateCylinder(`laser-${id}-beam`, beamOptions, this.scene);
    this.beam.parent = this.beamRoot;
    this.beam.rotation.x = -Math.PI / 2;
    this.beam.position.z = 0.5;
    this.beam.material = materials.laserBeam;

    this.beamRoot2 = new TransformNode(`laser-${id}-beamRoot2`, this.scene);
    this.beamRoot2.position.copyFrom(this.nose);

    this.beam2 = MeshBuilder.CreateCylinder(`laser-${id}-beam2`, beamOptions, this.scene);
    this.beam2.parent = this.beamRoot2;
    this.beam2.rotation.x = -Math.PI / 2;
    this.beam2.position.z = 0.5;
    this.beam2.material = materials.laserBeam;
    this.beam2.isVisible = false;

    this.loopId = this.ctx.systems.audio.startLoop(SOUND.laserHum, this.node.position);
  }

  update(dtSeconds: number): void {
    this.elapsedSeconds += dtSeconds;
    this.traceBeam();
    this.positionBeam();
    this.checkPlayerKill();

    const pulse = 1 + Math.sin(this.elapsedSeconds * 12) * 0.08;
    this.beam.scaling.x = LASER_RADIUS * 2 * pulse;
    this.beam.scaling.z = pulse;
    this.beam2.scaling.x = LASER_RADIUS * 2 * pulse;
    this.beam2.scaling.z = pulse;

    // Diff targets: turn off previous receivers not hit this frame.
    for (const target of this.prevTargets) {
      if (!this.activeTargets.has(target)) {
        target.onLaserHit(false);
      }
    }
    this.prevTargets.clear();
    for (const target of this.activeTargets) {
      this.prevTargets.add(target);
    }
    this.activeTargets.clear();
  }

  private alignHead(): void {
    this.nose.copyFrom(this.node.position);
    this.direction.scaleToRef(0.56, this.scratchOffset);
    this.nose.addInPlace(this.scratchOffset);

    const up = Vector3.Up();
    if (Math.abs(Vector3.Dot(this.direction, up)) > 0.99) {
      this.head.rotation.x = this.direction.y > 0 ? 0 : Math.PI;
      return;
    }
    this.head.lookAt(this.nose);
  }

  /** Trace the beam, including a single hop through a linked portal opening. */
  private traceBeam(): void {
    this.hasPortalHop = false;
    this.segment1Length = 0;
    this.segment2Length = 0;
    this.scratchOrigin.copyFrom(this.nose);
    let dir: Vector3 = this.direction;
    let remaining = MAX_DISTANCE;
    let segment = 1;

    for (let outer = 0; outer < 2; outer++) {
      for (let step = 0; step < 8 && remaining > 0.001; step++) {
        const portalCross = segment === 1 ? this.findPortalCrossing(this.scratchOrigin, dir, remaining) : null;
        const hit = this.ctx.systems.physics.raycast(this.scratchOrigin, dir, remaining);
        const nextSolid = hit ? hit.distance : remaining;

        if (portalCross && portalCross.t < nextSolid) {
          // Portal crossing happens before the next solid hit.
          this.hasPortalHop = true;
          this.segment1Length += portalCross.t;

          this.scratchHit.copyFrom(this.scratchOrigin);
          dir.scaleToRef(portalCross.t, this.scratchOffset);
          this.scratchHit.addInPlace(this.scratchOffset);
          this.portalEntry.copyFrom(this.scratchHit);

          const sourcePortal = this.ctx.systems.portals.getPortal(portalCross.sourceColor)!;
          const targetColor = portalCross.sourceColor === 'blue' ? 'orange' : 'blue';
          const targetPortal = this.ctx.systems.portals.getPortal(targetColor)!;

          portalPairTransformToRef(
            sourcePortal as unknown as PortalFrame,
            targetPortal as unknown as PortalFrame,
            this.pairTransform,
          );
          Vector3.TransformCoordinatesToRef(this.portalEntry, this.pairTransform, this.portalOut);
          Vector3.TransformNormalToRef(dir, this.pairTransform, this.portalOutDir);
          this.portalOutDir.normalize();
          this.portalOut.addInPlace(this.portalOutDir.scaleToRef(CONFIG.portals.exitNudge, this.scratchOffset));

          this.scratchOrigin.copyFrom(this.portalOut);
          dir = this.portalOutDir;
          remaining -= portalCross.t + CONFIG.portals.exitNudge;
          segment = 2;
          break;
        }

        // No portal hop; process the next solid hit (or open air).
        const segDist = hit ? hit.distance : remaining;
        if (segment === 1) {
          this.segment1Length += segDist;
        } else {
          this.segment2Length += segDist;
        }

        if (!hit) {
          return;
        }

        this.scratchEnd.copyFrom(this.scratchOrigin);
        dir.scaleToRef(segDist, this.scratchOffset);
        this.scratchEnd.addInPlace(this.scratchOffset);

        // Glass and relays let the beam continue.
        if (hit.mesh?.metadata?.glass || this.targetPassesThrough(hit.mesh?.metadata?.elementId)) {
          this.scratchOrigin.copyFrom(this.scratchEnd);
          dir.scaleToRef(GLASS_FUDGE, this.scratchOffset);
          this.scratchOrigin.addInPlace(this.scratchOffset);
          remaining -= segDist + GLASS_FUDGE;
          continue;
        }

        const targetId = hit.mesh?.metadata?.elementId as string | undefined;
        const target = targetId ? this.puzzle.laserTargets.get(targetId) : undefined;
        if (target) {
          target.onLaserHit(true);
          this.activeTargets.add(target);
        }
        return;
      }

      if (segment === 1) {
        // No portal hop happened; the beam is done.
        break;
      }
    }
  }

  private targetPassesThrough(elementId: string | undefined): boolean {
    if (!elementId) return false;
    const target = this.puzzle.laserTargets.get(elementId);
    return target?.passesBeamThrough?.() ?? false;
  }

  private findPortalCrossing(
    origin: Vector3,
    dir: Vector3,
    maxT: number,
  ): { t: number; sourceColor: 'blue' | 'orange' } | null {
    if (!this.ctx.systems.portals.isLinked) return null;

    let bestT = Infinity;
    let bestColor: 'blue' | 'orange' | null = null;

    for (const color of PORTAL_COLORS) {
      const portal = this.ctx.systems.portals.getPortal(color);
      if (!portal || !portal.isPlaced) continue;

      const denom = dir.x * portal.normal.x + dir.y * portal.normal.y + dir.z * portal.normal.z;
      if (Math.abs(denom) < 1e-6) continue;

      const signed = signedDistanceToPortalPlaneFast(origin, portal as unknown as PortalFrame);
      const t = -signed / denom;
      if (t <= 1e-4 || t >= maxT - 1e-4 || t >= bestT) continue;

      this.scratchHit.set(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
      if (
        isWithinPortalBoundsFast(
          this.scratchHit,
          portal as unknown as PortalFrame,
          CONFIG.portals.width / 2,
          CONFIG.portals.height / 2,
        )
      ) {
        bestT = t;
        bestColor = color;
      }
    }

    return bestColor ? { t: bestT, sourceColor: bestColor } : null;
  }

  private positionBeam(): void {
    this.positionSegment(this.beamRoot, this.beam, this.nose, this.direction, this.segment1Length, this.segment1End);

    if (this.hasPortalHop) {
      this.beam2.isVisible = true;
      this.positionSegment(
        this.beamRoot2,
        this.beam2,
        this.portalOut,
        this.portalOutDir,
        this.segment2Length,
        this.segment2End,
      );
    } else {
      this.beam2.isVisible = false;
    }
  }

  private positionSegment(
    root: TransformNode,
    beam: AbstractMesh,
    start: Vector3,
    dir: Vector3,
    length: number,
    endOut: Vector3,
  ): void {
    root.position.copyFrom(start);
    if (length < 0.001) {
      beam.isVisible = false;
      return;
    }
    beam.isVisible = true;

    dir.scaleToRef(length, this.scratchOffset);
    endOut.copyFrom(start).addInPlace(this.scratchOffset);
    root.lookAt(endOut);

    beam.scaling.y = length;
    beam.position.z = length / 2;
  }

  private checkPlayerKill(): void {
    const px = this.ctx.systems.player.position.x;
    const py = this.ctx.systems.player.position.y;
    const pz = this.ctx.systems.player.position.z;

    let d2 = nearestSquared(px, py, pz, this.nose, this.segment1End);
    if (this.hasPortalHop) {
      const d2Seg = nearestSquared(px, py, pz, this.portalOut, this.segment2End);
      if (d2Seg < d2) d2 = d2Seg;
    }

    if (d2 <= PLAYER_KILL_RADIUS * PLAYER_KILL_RADIUS) {
      this.ctx.events.emit('player:died', { cause: 'laser' });
      this.ctx.systems.audio.playAt(SOUND.laserKill, this.ctx.systems.player.position);
    }
  }

  protected beforeDispose(): void {
    if (this.loopId) {
      this.ctx.systems.audio.stopLoop(this.loopId);
      this.loopId = null;
    }
    this.beamRoot.dispose(false, false);
    this.beamRoot2.dispose(false, false);
  }
}

/** Squared distance from a point to the line segment a-b, scalar math. */
function nearestSquared(
  px: number,
  py: number,
  pz: number,
  a: Vector3,
  b: Vector3,
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const abLenSq = abx * abx + aby * aby + abz * abz;

  if (abLenSq < 1e-12) {
    const dx = px - a.x;
    const dy = py - a.y;
    const dz = pz - a.z;
    return dx * dx + dy * dy + dz * dz;
  }

  const apx = px - a.x;
  const apy = py - a.y;
  const apz = pz - a.z;
  let t = (apx * abx + apy * aby + apz * abz) / abLenSq;
  t = Math.max(0, Math.min(1, t));

  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  const cz = a.z + abz * t;

  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  return dx * dx + dy * dy + dz * dz;
}
