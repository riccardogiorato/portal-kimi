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
    const rotation = spec.orientation === 'x' ? Quaternion.RotationAxis(Vector3.Up(), Math.PI / 2) : null;

    const mesh = MeshBuilder.CreateBox(
      `glass-${id}`,
      { width, height, depth: GLASS_THICKNESS },
      this.scene,
    );
    // The visual must rotate with the body — an 'x' pane lies in the YZ
    // plane (normal along X), not the default XY.
    if (rotation) mesh.rotationQuaternion = rotation.clone();
    mesh.material = this.ctx.systems.rendering.materials.glass();
    mesh.metadata = { ...mesh.metadata, glass: true };
    this.track(mesh);

    const bodyOptions: StaticBoxOptions = {
      id: `glass-body-${id}`,
      size: new Vector3(width, height, GLASS_THICKNESS),
      position: this.node.position.clone(),
    };
    if (rotation) {
      bodyOptions.rotation = rotation;
    }

    this.body = this.ctx.systems.physics.createStaticBox(bodyOptions);
    this.trackBody(this.body);
    // The laser's raycast sees the PROXY mesh, not the visual — the glass
    // flag must live on the proxy or the beam stops dead at the pane.
    const proxy = this.ctx.systems.physics.getMeshForBody(this.body);
    if (proxy) proxy.metadata = { glass: true, portalable: false };
  }

  update(_dtSeconds: number): void {
    // Static barrier, nothing per frame.
  }
}
