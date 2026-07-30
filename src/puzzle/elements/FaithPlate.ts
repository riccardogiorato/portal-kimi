/**
 * puzzle/elements/FaithPlate.ts — Aerial Faith Plate.
 */
import { MeshBuilder, Vector3 } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import type { PhysicsBodyHandle } from '../../core/types';
import { CONFIG } from '../../core/Config';
import { damp } from '../../core/math';
import { SOUND } from '../../core/soundIds';
import { solveBallisticLaunch } from '../ballistic';
import { BasePuzzleElement } from '../PuzzleElement';
import { PuzzleMaterials } from '../materials';
import type { PuzzleContext } from '../types';
import { circleIntersectsRectangle } from '../contacts';

const PLATE_WIDTH = 0.9;
const PLATE_DEPTH = 0.9;
const COOLDOWN_SECONDS = 0.6;
const TRIGGER_Y_OFFSET = 0.14;
const TRIGGER_HEIGHT_TOLERANCE = 0.45;

type FaithPlateSpec = {
  id: string;
  type: 'faith-plate';
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  power?: number;
};

export class FaithPlate extends BasePuzzleElement<FaithPlateSpec> {
  private readonly arm: AbstractMesh;
  private readonly body: PhysicsBodyHandle;
  private readonly launchVelocity: Vector3;
  private readonly scratchTriggerCenter = Vector3.Zero();
  private readonly scratchBodyPos = Vector3.Zero();
  private cooldown = 0;
  private armTarget = 0;
  private armCurrent = 0;

  constructor(
    id: string,
    spec: FaithPlateSpec,
    context: PuzzleContext,
    materials: PuzzleMaterials,
  ) {
    super(id, spec, context, materials);

    const base = MeshBuilder.CreateBox(
      `fp-${id}-base`,
      { width: PLATE_WIDTH + 0.14, height: 0.22, depth: PLATE_DEPTH + 0.14 },
      this.scene,
    );
    base.position.y = 0.11;
    base.material = this.ctx.systems.rendering.materials.trimMetal();
    this.track(base);

    this.arm = MeshBuilder.CreateBox(
      `fp-${id}-arm`,
      { width: PLATE_WIDTH, height: 0.08, depth: PLATE_DEPTH },
      this.scene,
    );
    this.arm.position.set(0, 0.18, -PLATE_DEPTH * 0.4);
    this.arm.material = this.ctx.systems.rendering.materials.buttonHousing();
    this.arm.rotation.x = -0.22;
    this.track(this.arm);

    const halfSize = new Vector3(PLATE_WIDTH, 0.1, PLATE_DEPTH);
    this.scratchTriggerCenter.copyFrom(this.node.position).addInPlace(new Vector3(0, 0.05, 0));
    this.body = this.ctx.systems.physics.createStaticBox({
      id: `fp-${id}-body`,
      size: halfSize,
      position: this.scratchTriggerCenter,
    });
    this.trackBody(this.body);

    const launch = solveBallisticLaunch(
      spec.position,
      spec.target,
      CONFIG.player.gravity,
      spec.power ?? 1,
    );
    this.launchVelocity = new Vector3(launch.velocity.x, launch.velocity.y, launch.velocity.z);

    const dx = spec.target.x - spec.position.x;
    const dz = spec.target.z - spec.position.z;
    if (dx !== 0 || dz !== 0) {
      this.node.rotation.y = Math.atan2(dx, dz);
    }
  }

  onLinkState(_active: boolean): void {
    // Faith plates are not link-toggleable in this spec.
  }

  update(dtSeconds: number): void {
    if (this.cooldown > 0) {
      this.cooldown -= dtSeconds;
    }

    const center = this.node.position;
    this.scratchTriggerCenter.set(center.x, center.y + TRIGGER_Y_OFFSET, center.z);

    const player = this.ctx.systems.player.position;
    if (this.inTriggerVolume(player, CONFIG.player.radius)) {
      this.launchPlayer();
    }

    const physics = this.ctx.systems.physics;
    for (const t of physics.getTeleportables()) {
      physics.getBodyPositionToRef(t.handle, this.scratchBodyPos);
      if (this.inTriggerVolume(this.scratchBodyPos, t.radius)) {
        this.launchBody(t.handle);
      }
    }

    this.armCurrent = damp(this.armCurrent, this.armTarget, 18, dtSeconds);
    this.arm.rotation.x = -0.22 + this.armCurrent;
    if (this.armCurrent > 0.5) {
      this.armTarget = 0;
    }
  }

  private inTriggerVolume(point: Vector3, radius: number): boolean {
    if (Math.abs(point.y - this.scratchTriggerCenter.y) > TRIGGER_HEIGHT_TOLERANCE) {
      return false;
    }
    return circleIntersectsRectangle(
      point,
      radius,
      this.scratchTriggerCenter,
      PLATE_WIDTH / 2,
      PLATE_DEPTH / 2,
    );
  }

  private launchPlayer(): void {
    if (this.cooldown > 0) return;
    this.cooldown = COOLDOWN_SECONDS;
    this.armTarget = 1.2;
    this.ctx.systems.player.launch(this.launchVelocity);
    this.ctx.systems.audio.playAt(SOUND.faithPlateLaunch, this.node.position);
  }

  private launchBody(handle: PhysicsBodyHandle): void {
    if (this.cooldown > 0) return;
    this.cooldown = COOLDOWN_SECONDS;
    this.armTarget = 1.2;
    this.ctx.systems.physics.setLinearVelocity(handle, this.launchVelocity);
    this.ctx.systems.audio.playAt(SOUND.faithPlateLaunch, this.node.position);
  }
}
