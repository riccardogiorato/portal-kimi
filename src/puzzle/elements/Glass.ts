/**
 * puzzle/elements/Glass.ts — transparent barrier pane that lasers pass through.
 */
import { MeshBuilder, Quaternion, Vector3 } from '@babylonjs/core';
import type { PhysicsBodyHandle, PuzzleElementSpec, StaticBoxOptions } from '../../core/types';
import { BasePuzzleElement } from '../PuzzleElement';
import { PuzzleMaterials } from '../materials';
import type { PuzzleContext } from '../types';

const GLASS_THICKNESS = 0.08;

type GlassSpec = Extract<PuzzleElementSpec, { type: 'glass' }>;

export class Glass extends BasePuzzleElement<GlassSpec> {
  private readonly body: PhysicsBodyHandle;

  constructor(
    id: string,
    spec: GlassSpec,
    context: PuzzleContext,
    materials: PuzzleMaterials,
  ) {
    super(id, spec, context, materials);

    const { width, height } = spec.size;
    const mesh = MeshBuilder.CreateBox(
      `glass-${id}`,
      { width, height, depth: GLASS_THICKNESS },
      this.scene,
    );
    mesh.material = this.ctx.systems.rendering.materials.glass();
    mesh.metadata = { ...mesh.metadata, glass: true };
    this.track(mesh);

    const bodyOptions: StaticBoxOptions = {
      id: `glass-body-${id}`,
      size: new Vector3(width, height, GLASS_THICKNESS),
      position: this.node.position.clone(),
    };
    if (spec.orientation === 'x') {
      bodyOptions.rotation = Quaternion.RotationAxis(Vector3.Up(), Math.PI / 2);
    }

    this.body = this.ctx.systems.physics.createStaticBox(bodyOptions);
    this.trackBody(this.body);
  }

  update(_dtSeconds: number): void {
    // Static barrier, nothing per frame.
  }
}
