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
      // 0.3 thick, top flush with the visual surface: a 0.02 slab let bodies
      // tunnel through when they spawned intersecting it (fall-through death).
      size: new Vector3(width, 0.3, depth),
      position: this.node.position.clone().add(new Vector3(0, GOO_HEIGHT + 0.01 - 0.15, 0)),
    });
    // The physics proxy is collision-only — hide it or it renders as a white
    // material-less box floating over the goo surface.
    const proxyMesh = this.ctx.systems.physics.getMeshForBody(this.body);
    if (proxyMesh) proxyMesh.isVisible = false;
    this.trackBody(this.body);

    context.gooVolumes.push({
      id,
      contains: (point: Vector3) => this.contains(point),
    });
  }

  private readonly feetPoint = Vector3.Zero();

  update(_dtSeconds: number): void {
    // Test the capsule FEET, not the center: the center floats ~1m above the
    // surface, so a center-based test never fired for a wading player.
    const pos = this.ctx.systems.player.position;
    this.feetPoint.set(pos.x, pos.y - this.ctx.config.player.height / 2, pos.z);
    if (this.contains(this.feetPoint)) {
      this.ctx.events.emit('player:died', { cause: 'goo' });
      this.ctx.systems.audio.playAt(SOUND.gooDeath, this.node.position);
    }
  }

  dispose(): void {
    const idx = this.puzzle.gooVolumes.findIndex((g) => g.id === this.id);
    if (idx >= 0) this.puzzle.gooVolumes.splice(idx, 1);
    super.dispose();
  }

  /**
   * Kill-line test: inside the footprint AND below the surface + kill depth.
   * No lower bound — anything under the surface within the footprint is dead.
   * The line sits above the solid proxy top (0.17) so a body resting on the
   * goo still dies/fizzles; a jump arc over the pit (feet ≳ 0.8) clears it.
   */
  contains(point: Vector3): boolean {
    const killLine = this.node.position.y + GOO_HEIGHT + CONFIG.puzzle.gooKillDepth;
    return (
      point.y < killLine &&
      Math.abs(point.x - this.node.position.x) <= this.spec.size.width / 2 &&
      Math.abs(point.z - this.node.position.z) <= this.spec.size.depth / 2
    );
  }
}
