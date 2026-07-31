/**
 * puzzle/elements/Platform.ts — moving platform with physics-momentum carry.
 */
import { MeshBuilder, Quaternion, Vector3 } from '@babylonjs/core';
import type { PhysicsBodyHandle, PuzzleElementSpec } from '../../core/types';
import { CONFIG } from '../../core/Config';
import { SOUND } from '../../core/soundIds';
import { BasePuzzleElement } from '../PuzzleElement';
import { PuzzleMaterials } from '../materials';
import type { PuzzleContext } from '../types';
import { withToRef } from '../physicsToRef';

const PLATFORM_SIZE = { width: 2.2, height: 0.22, depth: 2.2 };
/** Carry footprint: nearly the full 2.2m deck (edge margin so a rider about
 * to step off isn't yanked back). */
const FOOTPRINT_HALF = 1.0;

interface PlatformSpec extends Extract<PuzzleElementSpec, { type: 'platform' }> {}

export class Platform extends BasePuzzleElement<PlatformSpec> {
  private readonly body: PhysicsBodyHandle;
  private active: boolean;
  private loopId: string | null = null;
  private readonly target = Vector3.Zero();
  private readonly velocity = Vector3.Zero();
  private currentIndex = 0;
  private forward = true;
  private readonly scratchDelta = Vector3.Zero();
  private readonly scratchDir = Vector3.Zero();
  private readonly scratchStep = Vector3.Zero();
  private readonly scratchBodyPos = Vector3.Zero();
  private readonly scratchBodyVel = Vector3.Zero();
  private readonly scratchSyncPos = Vector3.Zero();
  private readonly identityQuaternion = Quaternion.Identity();

  constructor(
    id: string,
    spec: PlatformSpec,
    context: PuzzleContext,
    materials: PuzzleMaterials,
  ) {
    super(id, spec, context, materials);

    this.active = spec.startsActive ?? true;

    const mesh = MeshBuilder.CreateBox(
      `platform-${id}`,
      { width: PLATFORM_SIZE.width, height: PLATFORM_SIZE.height, depth: PLATFORM_SIZE.depth },
      this.scene,
    );
    mesh.position.y = PLATFORM_SIZE.height / 2;
    mesh.material = this.ctx.systems.rendering.materials.trimMetal();
    mesh.metadata = { ...mesh.metadata, portalable: false };
    this.track(mesh);

    const start = spec.path[0] ?? { x: 0, y: 0, z: 0 };
    this.node.position.set(start.x, start.y, start.z);

    this.scratchSyncPos.copyFrom(this.node.position);
    this.scratchSyncPos.y += PLATFORM_SIZE.height / 2;
    this.body = this.ctx.systems.physics.createStaticBox({
      id: `platform-body-${id}`,
      size: new Vector3(PLATFORM_SIZE.width, PLATFORM_SIZE.height, PLATFORM_SIZE.depth),
      position: this.scratchSyncPos,
    });
    this.trackBody(this.body);

    if (spec.path.length > 1) {
      this.target.set(spec.path[1].x, spec.path[1].y, spec.path[1].z);
    } else {
      this.target.copyFrom(this.node.position);
    }

    if (this.active && spec.path.length > 1) {
      this.loopId = this.ctx.systems.audio.startLoop(SOUND.platformMove, this.node.position);
    }
  }

  onLinkState(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active && this.spec.path.length > 1) {
      this.loopId = this.ctx.systems.audio.startLoop(SOUND.platformMove, this.node.position);
    } else if (!active && this.loopId) {
      this.ctx.systems.audio.stopLoop(this.loopId);
      this.loopId = null;
    }
  }

  update(dtSeconds: number): void {
    if (!this.active || this.spec.path.length < 2) {
      this.velocity.setAll(0);
      return;
    }

    const speed = this.spec.speed ?? CONFIG.puzzle.platformDefaultSpeed;
    this.scratchDelta.copyFrom(this.target).subtractInPlace(this.node.position);
    const distance = this.scratchDelta.length();

    if (distance < 0.02) {
      this.advanceWaypoint();
      this.scratchDelta.copyFrom(this.target).subtractInPlace(this.node.position);
    }

    const remaining = this.scratchDelta.length();
    if (remaining > 0.001) {
      this.scratchDir.copyFrom(this.scratchDelta).normalize();
      const step = Math.min(speed, remaining / Math.max(dtSeconds, 1e-6));
      this.scratchDir.scaleToRef(step, this.velocity);
    } else {
      this.velocity.setAll(0);
    }

    this.velocity.scaleToRef(dtSeconds, this.scratchStep);
    this.node.position.addInPlace(this.scratchStep);
    this.syncBody();

    if (this.playerStandsOnPlatform()) {
      this.ctx.systems.player.addExternalVelocity(this.velocity);
    }

    const physics = withToRef(this.ctx.systems.physics);
    const cubeHalf = CONFIG.physics.cubeSize / 2;
    for (const t of physics.getTeleportables()) {
      physics.getBodyPositionToRef(t.handle, this.scratchBodyPos);
      if (this.pointOnTop(this.scratchBodyPos, this.scratchBodyPos.y - cubeHalf)) {
        physics.getLinearVelocityToRef(t.handle, this.scratchBodyVel);
        this.scratchBodyVel.addInPlace(this.velocity);
        physics.setLinearVelocity(t.handle, this.scratchBodyVel);
      }
    }
  }

  private advanceWaypoint(): void {
    if (this.spec.path.length <= 1) return;
    if (this.forward) {
      this.currentIndex++;
      if (this.currentIndex >= this.spec.path.length - 1) {
        this.currentIndex = this.spec.path.length - 1;
        this.forward = false;
      }
    } else {
      this.currentIndex--;
      if (this.currentIndex <= 0) {
        this.currentIndex = 0;
        this.forward = true;
      }
    }
    const next = this.spec.path[this.currentIndex + (this.forward ? 1 : -1)];
    if (!next) return;
    this.target.set(next.x, next.y, next.z);
  }

  private syncBody(): void {
    this.scratchSyncPos.copyFrom(this.node.position);
    this.scratchSyncPos.y += PLATFORM_SIZE.height / 2;
    this.ctx.systems.physics.teleportBody(this.body, this.scratchSyncPos, this.identityQuaternion);
  }

  private playerStandsOnPlatform(): boolean {
    // player.position is the capsule CENTER — test the FEET against the deck.
    const pos = this.ctx.systems.player.position;
    return this.pointOnTop(pos, pos.y - CONFIG.player.height / 2);
  }

  private pointOnTop(point: Vector3, bottomY: number): boolean {
    const localY = bottomY - (this.node.position.y + PLATFORM_SIZE.height);
    if (localY < -0.1 || localY > 0.3) return false;
    return (
      Math.abs(point.x - this.node.position.x) <= FOOTPRINT_HALF &&
      Math.abs(point.z - this.node.position.z) <= FOOTPRINT_HALF
    );
  }

  protected beforeDispose(): void {
    if (this.loopId) {
      this.ctx.systems.audio.stopLoop(this.loopId);
      this.loopId = null;
    }
  }
}
