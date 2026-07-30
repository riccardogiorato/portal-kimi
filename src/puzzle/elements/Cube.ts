/**
 * puzzle/elements/Cube.ts — Weighted Storage Cube.
 */
import { MeshBuilder, Vector3 } from '@babylonjs/core';
import type { AbstractMesh, Mesh } from '@babylonjs/core';
import type { PhysicsBodyHandle } from '../../core/types';
import { CONFIG } from '../../core/Config';
import { SOUND } from '../../core/soundIds';
import { BasePuzzleElement } from '../PuzzleElement';
import { PuzzleMaterials } from '../materials';
import type { PuzzleContext } from '../types';

const CUBE_RADIUS = 0.45;
const BOUNCE_COOLDOWN_SECONDS = 0.25;
const BOUNCE_IMPACT_SPEED = 1.8;
const FIZZLE_ANIM_SECONDS = 0.35;

export class Cube extends BasePuzzleElement<{
  id: string;
  type: 'cube';
  kind?: 'weighted';
  position: { x: number; y: number; z: number };
}> {
  readonly objectId: string;
  mesh: AbstractMesh;
  body: PhysicsBodyHandle;
  private fizzling = false;
  private fizzleTimer = 0;
  private readonly previousVelocity = new Vector3();
  private readonly scratchVelocity = new Vector3();
  private bounceCooldown = 0;

  constructor(
    id: string,
    spec: Cube['spec'],
    context: PuzzleContext,
    materials: PuzzleMaterials,
  ) {
    super(id, spec, context, materials);

    this.objectId = `${id}-object`;
    const size = CONFIG.physics.cubeSize;

    const cubeMesh = MeshBuilder.CreateBox(`cube-${id}`, { size }, this.scene);
    cubeMesh.material = this.ctx.systems.rendering.materials.cubeShell();
    cubeMesh.metadata = {
      ...cubeMesh.metadata,
      grabbable: true,
      bodyHandle: null,
      objectId: this.objectId,
      elementId: id,
    };
    this.track(cubeMesh);
    this.mesh = cubeMesh;

    this.body = this.ctx.systems.physics.createBoxBody({
      id: `cube-body-${id}`,
      size: new Vector3(size, size, size),
      position: new Vector3(spec.position.x, spec.position.y, spec.position.z),
      mass: CONFIG.physics.cubeMass,
      linearDamping: CONFIG.physics.cubeLinearDamping,
      angularDamping: CONFIG.physics.cubeAngularDamping,
      friction: 0.55,
      restitution: 0.2,
      mesh: cubeMesh as Mesh,
    });
    this.trackBody(this.body);

    cubeMesh.metadata = { ...cubeMesh.metadata, bodyHandle: this.body };

    this.ctx.systems.physics.registerTeleportable(this.body, {
      id: this.objectId,
      radius: CUBE_RADIUS,
    });
  }

  update(dtSeconds: number): void {
    if (this.fizzling) {
      this.updateFizzle(dtSeconds);
      return;
    }

    this.ctx.systems.physics.getLinearVelocityToRef(this.body, this.scratchVelocity);
    this.checkBounce(this.scratchVelocity, dtSeconds);
    this.previousVelocity.copyFrom(this.scratchVelocity);

    for (const goo of this.puzzle.gooVolumes) {
      if (goo.contains(this.mesh.position)) {
        this.fizzle('dispenser');
        break;
      }
    }
  }

  /** Public API so puzzle system can fizzle a cube when its portal closes or it touches goo. */
  fizzle(reason: 'portal-closed' | 'dispenser'): void {
    if (this.fizzling) return;
    this.fizzling = true;
    this.fizzleTimer = FIZZLE_ANIM_SECONDS;
    this.ctx.systems.audio.playAt(SOUND.cubeFizzle, this.mesh.position);
    this.events.emit('object:fizzled', { objectId: this.objectId, reason });
  }

  private checkBounce(velocity: Vector3, dt: number): void {
    if (this.bounceCooldown > 0) {
      this.bounceCooldown -= dt;
    }
    const speed = velocity.length();
    const prevSpeed = this.previousVelocity.length();
    if (this.bounceCooldown <= 0 && speed < prevSpeed - BOUNCE_IMPACT_SPEED) {
      this.ctx.systems.audio.playAt(SOUND.cubeBounce, this.mesh.position, { volume: 0.8 });
      this.bounceCooldown = BOUNCE_COOLDOWN_SECONDS;
    }
  }

  private updateFizzle(dt: number): void {
    this.fizzleTimer -= dt;
    const t = 1 - Math.max(0, this.fizzleTimer) / FIZZLE_ANIM_SECONDS;
    const s = Math.max(0.02, 1 - t);
    this.mesh.scaling.set(s, s, s);
    this.mesh.material = this.materials.orangeEmissive;

    if (this.fizzleTimer <= 0) {
      this.dispose();
    }
  }

  protected beforeDispose(): void {
    this.ctx.systems.physics.unregisterTeleportable(this.body);
  }
}
