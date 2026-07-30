/**
 * puzzle/elements/CubeDispenser.ts — ceiling cube dispenser.
 */
import { MeshBuilder, Vector3 } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import { SOUND } from '../../core/soundIds';
import { damp } from '../../core/math';
import type { PuzzleElementSpec } from '../../core/types';
import { BasePuzzleElement } from '../PuzzleElement';
import { PuzzleMaterials } from '../materials';
import type { PuzzleContext } from '../types';
import { Cube } from './Cube';

const RESPAWN_DELAY_SECONDS = 0.6;
const IRIS_OPEN_ANGLE = Math.PI / 2.2;

type CubeDispenserSpec = Extract<PuzzleElementSpec, { type: 'cube-dispenser' }>;

export class CubeDispenser extends BasePuzzleElement<CubeDispenserSpec> {
  private currentCube: Cube | null = null;
  private pendingRespawn = false;
  private respawnTimer = 0;
  private readonly indicator: AbstractMesh;
  private readonly irisBlades: AbstractMesh[] = [];

  constructor(
    id: string,
    spec: CubeDispenserSpec,
    context: PuzzleContext,
    materials: PuzzleMaterials,
  ) {
    super(id, spec, context, materials);

    const tube = MeshBuilder.CreateCylinder(
      `disp-${id}-tube`,
      { height: 1.2, diameter: 0.55, tessellation: 24 },
      this.scene,
    );
    tube.position.y = 0.6;
    tube.rotation.x = Math.PI / 2;
    tube.material = this.ctx.systems.rendering.materials.darkMetal();
    this.track(tube);

    const ring = MeshBuilder.CreateTorus(
      `disp-${id}-ring`,
      { diameter: 0.65, thickness: 0.08, tessellation: 24 },
      this.scene,
    );
    ring.position.y = 0.05;
    ring.rotation.x = Math.PI / 2;
    ring.material = this.ctx.systems.rendering.materials.trimMetal();
    this.track(ring);

    for (let i = 0; i < 4; i++) {
      const blade = MeshBuilder.CreateBox(
        `disp-${id}-blade-${i}`,
        { width: 0.14, height: 0.04, depth: 0.42 },
        this.scene,
      );
      blade.position.y = 0.03;
      blade.rotation.y = (i * Math.PI) / 2;
      blade.material = this.ctx.systems.rendering.materials.trimMetal();
      blade.parent = tube;
      this.irisBlades.push(blade);
    }

    this.indicator = MeshBuilder.CreateBox(
      `disp-${id}-indicator`,
      { width: 0.12, height: 0.03, depth: 0.03 },
      this.scene,
    );
    this.indicator.position.set(0, 0.6, 0.31);
    this.indicator.material = materials.orangeEmissive;
    this.track(this.indicator);

    this.on('object:fizzled', ({ objectId }) => {
      if (this.currentCube && this.currentCube.objectId === objectId) {
        this.currentCube = null;
        this.scheduleDrop(RESPAWN_DELAY_SECONDS);
      }
    });

    if (spec.initialDrop ?? true) {
      this.scheduleDrop(0.1);
    }
  }

  protected onLinkState(active: boolean): void {
    if (active && !this.pendingRespawn && !this.currentCube) {
      this.scheduleDrop(0);
    }
  }

  update(dtSeconds: number): void {
    if (this.currentCube) {
      this.currentCube.update(dtSeconds);
      if (this.currentCube.disposed) {
        this.currentCube = null;
      }
    }

    if (this.pendingRespawn) {
      this.respawnTimer -= dtSeconds;
      if (this.respawnTimer <= 0) {
        this.dropCube();
      }
    }

    const targetAngle = this.currentCube ? IRIS_OPEN_ANGLE : 0;
    for (let i = 0; i < this.irisBlades.length; i++) {
      const blade = this.irisBlades[i];
      const base = (i * Math.PI) / 2;
      blade.rotation.y = damp(blade.rotation.y, base + targetAngle, 14, dtSeconds);
    }

    this.indicator.material = this.currentCube
      ? this.materials.cyanEmissive
      : this.materials.orangeEmissive;
  }

  private scheduleDrop(delaySeconds: number): void {
    if (this.pendingRespawn) return;
    this.pendingRespawn = true;
    this.respawnTimer = delaySeconds;
  }

  private dropCube(): void {
    this.pendingRespawn = false;
    const dropPosition = {
      x: this.node.position.x,
      y: this.node.position.y - 0.65,
      z: this.node.position.z,
    };
    this.currentCube = new Cube(
      `${this.id}:cube`,
      { id: `${this.id}:cube`, type: 'cube', position: dropPosition },
      { ctx: this.ctx, parent: this.node.parent! as import('@babylonjs/core').TransformNode, laserTargets: this.puzzle.laserTargets, gooVolumes: this.puzzle.gooVolumes },
      this.materials,
    );
    // Small nudge so the cube clears the tube on the same frame.
    this.ctx.systems.physics.setLinearVelocity(
      this.currentCube.body,
      new Vector3(0, -1.2, 0),
    );
    this.ctx.systems.audio.playAt(SOUND.dispenserDrop, this.node.position);
  }

  protected beforeDispose(): void {
    if (this.currentCube) {
      this.currentCube.dispose();
      this.currentCube = null;
    }
  }
}
