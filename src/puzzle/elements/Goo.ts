/**
 * puzzle/elements/Goo.ts — deadly toxic pool.
 */
import { MeshBuilder, Vector3 } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import type { PhysicsBodyHandle, PuzzleElementSpec } from '../../core/types';
import { CONFIG } from '../../core/Config';
import { SOUND } from '../../core/soundIds';
import { BasePuzzleElement } from '../PuzzleElement';
import { PuzzleMaterials } from '../materials';
import { pointInAABB } from '../contacts';
import type { PuzzleContext } from '../types';

const GOO_HEIGHT = 0.15;

type GooSpec = Extract<PuzzleElementSpec, { type: 'goo' }>;

export class Goo extends BasePuzzleElement<GooSpec> {
  private readonly body: PhysicsBodyHandle;
  private readonly surface: AbstractMesh;

  constructor(
    id: string,
    spec: GooSpec,
    context: PuzzleContext,
    materials: PuzzleMaterials,
  ) {
    super(id, spec, context, materials);

    const { width, depth } = spec.size;
    this.surface = MeshBuilder.CreateGround(
      `goo-${id}`,
      { width, height: depth, subdivisions: 2, updatable: false },
      this.scene,
    );
    this.surface.position.y = GOO_HEIGHT;
    this.surface.material = materials.gooSurface;
    this.surface.metadata = { ...this.surface.metadata, goo: true };
    this.track(this.surface);

    // Invisible trigger volume below the surface to detect death depth.
    const trigger = MeshBuilder.CreateBox(
      `goo-${id}-trigger`,
      { width, height: GOO_HEIGHT + CONFIG.puzzle.gooKillDepth, depth },
      this.scene,
    );
    trigger.position.y = -(GOO_HEIGHT + CONFIG.puzzle.gooKillDepth) / 2 + GOO_HEIGHT;
    trigger.isVisible = false;
    this.track(trigger);

    this.body = this.ctx.systems.physics.createStaticBox({
      id: `goo-body-${id}`,
      size: new Vector3(width, 0.02, depth),
      position: this.node.position.clone().add(new Vector3(0, GOO_HEIGHT + 0.01, 0)),
    });
    this.trackBody(this.body);

    context.gooVolumes.push({
      id,
      contains: (point: Vector3) => this.contains(point),
    });
  }

  update(_dtSeconds: number): void {
    if (this.contains(this.ctx.systems.player.position)) {
      this.ctx.events.emit('player:died', { cause: 'goo' });
      this.ctx.systems.audio.playAt(SOUND.gooDeath, this.node.position);
    }
  }

  dispose(): void {
    const idx = this.puzzle.gooVolumes.findIndex((g) => g.id === this.id);
    if (idx >= 0) this.puzzle.gooVolumes.splice(idx, 1);
    super.dispose();
  }

  contains(point: Vector3): boolean {
    const halfY = (GOO_HEIGHT + CONFIG.puzzle.gooKillDepth) / 2;
    return pointInAABB(
      { x: point.x, y: point.y, z: point.z },
      { x: this.node.position.x, y: this.node.position.y + GOO_HEIGHT - halfY, z: this.node.position.z },
      {
        x: this.spec.size.width / 2,
        y: halfY,
        z: this.spec.size.depth / 2,
      },
    );
  }
}
