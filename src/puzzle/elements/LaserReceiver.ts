/**
 * puzzle/elements/LaserReceiver.ts — laser activates links while illuminated.
 */
import { MeshBuilder, Vector3 } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import type { PuzzleElementSpec } from '../../core/types';
import { BasePuzzleElement } from '../PuzzleElement';
import { PuzzleMaterials } from '../materials';
import type { LaserTarget, PuzzleContext } from '../types';

/** Hold-through grace: must exceed one clamped frame (0.05s) with margin so
 * the receiver doesn't flicker on frame hitches (0.05 expired within a single
 * clamped frame and the receiver never latched). */
const HIT_GRACE_SECONDS = 0.15;

type LaserReceiverSpec = Extract<PuzzleElementSpec, { type: 'laser-receiver' }>;

export class LaserReceiver extends BasePuzzleElement<LaserReceiverSpec> implements LaserTarget {
  private readonly dish: AbstractMesh;
  private hitTimer = 0;
  private wasActive = false;

  constructor(
    id: string,
    spec: LaserReceiverSpec,
    context: PuzzleContext,
    materials: PuzzleMaterials,
  ) {
    super(id, spec, context, materials);

    const housing = MeshBuilder.CreateBox(
      `recv-${id}-housing`,
      { width: 0.35, height: 0.5, depth: 0.25 },
      this.scene,
    );
    housing.position.y = 0.25;
    housing.material = this.ctx.systems.rendering.materials.darkMetal();
    this.track(housing);

    this.dish = MeshBuilder.CreateCylinder(
      `recv-${id}-dish`,
      { height: 0.06, diameter: 0.28, tessellation: 24 },
      this.scene,
    );
    this.dish.position.set(0, 0.32, 0.14);
    this.dish.rotation.x = Math.PI / 2;
    this.dish.material = materials.orangeEmissive;
    this.track(this.dish);

    // The emitter's beam is a PHYSICS raycast — without a body it never
    // registers the receiver at all. The proxy carries the elementId the
    // emitter looks up in the laserTargets map.
    const body = this.ctx.systems.physics.createStaticBox({
      id: `recv-${id}-body`,
      size: new Vector3(0.35, 0.5, 0.25),
      position: this.node.position.clone().add(new Vector3(0, 0.25, 0)),
    });
    this.trackBody(body);
    const proxy = this.ctx.systems.physics.getMeshForBody(body);
    if (proxy) proxy.metadata = { elementId: id };

    this.puzzle.laserTargets.set(id, this);
  }

  getBeamTargetPosition(): Vector3 {
    return this.node.position.add(new Vector3(0, 0.32, 0.14));
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
    this.dish.material = active ? this.materials.cyanEmissive : this.materials.orangeEmissive;
  }

  dispose(): void {
    this.puzzle.laserTargets.delete(this.id);
    super.dispose();
  }
}
