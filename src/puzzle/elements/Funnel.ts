/**
 * puzzle/elements/Funnel.ts — excursion funnel volume.
 */
import { MeshBuilder, TransformNode, Vector3 } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import type { PuzzleElementSpec } from '../../core/types';
import { CONFIG } from '../../core/Config';
import { SOUND } from '../../core/soundIds';
import { BasePuzzleElement } from '../PuzzleElement';
import { PuzzleMaterials } from '../materials';
import type { PuzzleContext } from '../types';
import { withToRef } from '../physicsToRef';

const FUNNEL_EFFECT_SPEED = 0.4;
const INFLUENCE_RADIUS = CONFIG.puzzle.funnelRadius;
const CENTERING_STIFFNESS = 4.0; // m/s² per m of lateral offset
const MAX_CENTER_SPEED = 3.0; // m/s
const PERP_DAMPING = 10.0; // exponential decay per second

type FunnelSpec = Extract<PuzzleElementSpec, { type: 'funnel' }>;

export class Funnel extends BasePuzzleElement<FunnelSpec> {
  private readonly beamRoot: TransformNode;
  private readonly beam: AbstractMesh;
  private readonly direction: Vector3;
  private enabled: boolean;
  private loopId: string | null = null;
  private scrollOffset = 0;
  private readonly endPoint = Vector3.Zero();
  private readonly scratchBodyPos = Vector3.Zero();
  private readonly scratchVelocity = Vector3.Zero();
  private readonly scratchAxisForce = Vector3.Zero();
  private readonly scratchCenter = Vector3.Zero();
  private readonly scratchClosest = Vector3.Zero();
  private readonly scratchOffset = Vector3.Zero();
  private readonly scratchParallel = Vector3.Zero();
  private readonly scratchPerp = Vector3.Zero();

  constructor(
    id: string,
    spec: FunnelSpec,
    context: PuzzleContext,
    materials: PuzzleMaterials,
  ) {
    super(id, spec, context, materials);

    this.direction = new Vector3(spec.direction.x, spec.direction.y, spec.direction.z).normalizeToNew();
    this.enabled = spec.startsActive ?? true;

    const emitter = MeshBuilder.CreateBox(
      `funnel-${id}-emitter`,
      { width: 0.35, height: 0.35, depth: 0.35 },
      this.scene,
    );
    emitter.material = this.ctx.systems.rendering.materials.trimMetal();
    this.track(emitter);

    this.beamRoot = new TransformNode(`funnel-${id}-root`, this.scene);
    this.beamRoot.parent = this.node;

    this.beam = MeshBuilder.CreateCylinder(
      `funnel-${id}-beam`,
      { height: spec.length, diameterTop: INFLUENCE_RADIUS * 2, diameterBottom: INFLUENCE_RADIUS * 2, tessellation: 24 },
      this.scene,
    );
    this.beam.parent = this.beamRoot;
    this.beam.rotation.x = -Math.PI / 2;
    this.beam.position.z = spec.length / 2;
    this.beam.material = materials.funnelEnergy;

    this.alignBeam();

    if (this.enabled) {
      this.loopId = this.ctx.systems.audio.startLoop(SOUND.funnelLoop, this.node.position);
    }
  }

  onLinkState(active: boolean): void {
    if (this.enabled === active) return;
    this.enabled = active;
    if (active && !this.loopId) {
      this.loopId = this.ctx.systems.audio.startLoop(SOUND.funnelLoop, this.node.position);
    } else if (!active && this.loopId) {
      this.ctx.systems.audio.stopLoop(this.loopId);
      this.loopId = null;
    }
  }

  update(dtSeconds: number): void {
    this.beam.isVisible = this.enabled;
    if (!this.enabled) return;

    this.scrollOffset += dtSeconds * FUNNEL_EFFECT_SPEED;
    this.materials.scrollTexture(this.materials.funnelEnergy, 0, -this.scrollOffset);
    this.alignBeam();

    const axisSpeed = (this.spec.polarity === 'pull' ? -1 : 1) * CONFIG.puzzle.funnelSpeed;
    const gravityCancel = CONFIG.player.gravity * dtSeconds;

    const physics = withToRef(this.ctx.systems.physics);
    const player = this.ctx.systems.player;

    if (this.inBeam(player.position, dtSeconds)) {
      this.direction.scaleToRef(axisSpeed * dtSeconds, this.scratchAxisForce);
      // Gravity cancel only when airborne: a grounded player is supported by
      // the floor (no gravity to cancel), so the unconditional +g·dt was a
      // net upward force that floated them up out of the beam and into the goo.
      if (!player.isGrounded) {
        this.scratchAxisForce.y += gravityCancel;
      }
      this.scratchAxisForce.addInPlace(this.scratchCenter);
      player.addExternalVelocity(this.scratchAxisForce);
    }

    for (const t of physics.getTeleportables()) {
      physics.getBodyPositionToRef(t.handle, this.scratchBodyPos);
      if (this.inBeam(this.scratchBodyPos, dtSeconds)) {
        physics.getLinearVelocityToRef(t.handle, this.scratchVelocity);

        // Cancel this frame's gravity and add the axial force.
        this.scratchVelocity.y += gravityCancel;
        this.direction.scaleToRef(axisSpeed * dtSeconds, this.scratchAxisForce);
        this.scratchVelocity.addInPlace(this.scratchAxisForce);

        // Damp perpendicular velocity toward the beam line.
        const parallelSpeed = Vector3.Dot(this.scratchVelocity, this.direction);
        this.direction.scaleToRef(parallelSpeed, this.scratchParallel);
        this.scratchPerp.copyFrom(this.scratchVelocity).subtractInPlace(this.scratchParallel);
        this.scratchPerp.scaleInPlace(Math.exp(-PERP_DAMPING * dtSeconds));

        this.scratchVelocity.copyFrom(this.scratchParallel).addInPlace(this.scratchPerp);
        // Centering force.
        this.scratchVelocity.addInPlace(this.scratchCenter);
        physics.setLinearVelocity(t.handle, this.scratchVelocity);
      }
    }
  }

  private alignBeam(): void {
    this.beamRoot.position.copyFrom(this.node.position);
    this.direction.scaleToRef(this.spec.length, this.endPoint);
    this.endPoint.addInPlace(this.node.position);
    this.beamRoot.lookAt(this.endPoint);
  }

  /**
   * Zero-allocation beam inclusion test. When true, scratchCenter holds the
   * centering-force vector for this frame (so callers must use it immediately).
   */
  private inBeam(point: Vector3, dtSeconds: number): boolean {
    this.scratchOffset.copyFrom(point).subtractInPlace(this.node.position);
    let t = Vector3.Dot(this.scratchOffset, this.direction);
    t = Math.max(0, Math.min(this.spec.length, t));

    this.scratchClosest.copyFrom(this.node.position);
    this.direction.scaleToRef(t, this.scratchOffset);
    this.scratchClosest.addInPlace(this.scratchOffset);

    this.scratchCenter.copyFrom(point).subtractInPlace(this.scratchClosest);
    const distanceSq = this.scratchCenter.lengthSquared();
    if (distanceSq > INFLUENCE_RADIUS * INFLUENCE_RADIUS) {
      this.scratchCenter.setAll(0);
      return false;
    }

    const distance = Math.sqrt(distanceSq);
    if (distance < 1e-4) {
      this.scratchCenter.setAll(0);
    } else {
      // scale = min(stiffness*dt, maxSpeed*dt / distance) => velocity capped at MAX_CENTER_SPEED
      const scale = Math.min(CENTERING_STIFFNESS * dtSeconds, (MAX_CENTER_SPEED * dtSeconds) / distance);
      this.scratchCenter.scaleInPlace(-scale);
    }
    return true;
  }

  protected beforeDispose(): void {
    if (this.loopId) {
      this.ctx.systems.audio.stopLoop(this.loopId);
      this.loopId = null;
    }
    // beamRoot is a child of this.node and will be disposed by the base cleanup.
  }
}
