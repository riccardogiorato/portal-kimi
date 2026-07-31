/**
 * puzzle/elements/LaserRelay.ts — relay that lets the laser pass through.
 */
import { MeshBuilder, Vector3 } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import type { PuzzleElementSpec } from '../../core/types';
import { BasePuzzleElement } from '../PuzzleElement';
import { PuzzleMaterials } from '../materials';
import type { LaserTarget, PuzzleContext } from '../types';

const HIT_GRACE_SECONDS = 0.05;

type LaserRelaySpec = Extract<PuzzleElementSpec, { type: 'laser-relay' }>;

export class LaserRelay extends BasePuzzleElement<LaserRelaySpec> implements LaserTarget {
  private readonly lens: AbstractMesh;
  private hitTimer = 0;
  private wasActive = false;

  constructor(
    id: string,
    spec: LaserRelaySpec,
    context: PuzzleContext,
    materials: PuzzleMaterials,
  ) {
    super(id, spec, context, materials);

    const housing = MeshBuilder.CreateBox(
      `relay-${id}-housing`,
      { width: 0.25, height: 0.48, depth: 0.25 },
      this.scene,
    );
    housing.position.y = 0.24;
    housing.material = this.ctx.systems.rendering.materials.darkMetal();
    this.track(housing);

    this.lens = MeshBuilder.CreateSphere(
      `relay-${id}-lens`,
      { diameter: 0.22, segments: 12 },
      this.scene,
    );
    this.lens.position.y = 0.39;
    this.lens.material = materials.orangeEmissive;
    this.track(this.lens);

    // Physics body so the beam's raycast registers the relay (and passes
    // through it via passesBeamThrough).
    const body = this.ctx.systems.physics.createStaticBox({
      id: `relay-${id}-body`,
      size: new Vector3(0.25, 0.48, 0.25),
      position: this.node.position.clone().add(new Vector3(0, 0.24, 0)),
    });
    this.trackBody(body);
    const proxy = this.ctx.systems.physics.getMeshForBody(body);
    if (proxy) proxy.metadata = { elementId: id };

    this.puzzle.laserTargets.set(id, this);
  }

  passesBeamThrough(): boolean {
    return true;
  }

  getBeamTargetPosition(): Vector3 {
    return this.node.position.add(new Vector3(0, 0.39, 0));
  }

  onLaserHit(active: boolean): void {
    if (active) {
      this.hitTimer = HIT_GRACE_SECONDS;
    }
  }

  update(dtSeconds: number): void {
    if (this.hitTimer > 0) {
      this.hitTimer -= dtSeconds;
    }
    const active = this.hitTimer > 0;
    if (active && !this.wasActive) {
      this.emitActivated();
    } else if (!active && this.wasActive) {
      this.emitDeactivated();
    }
    this.wasActive = active;
    this.lens.material = active ? this.materials.cyanEmissive : this.materials.orangeEmissive;
  }

  dispose(): void {
    this.puzzle.laserTargets.delete(this.id);
    super.dispose();
  }
}
