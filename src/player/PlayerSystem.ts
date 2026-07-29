/**
 * STUB — replaced by the player subsystem agent.
 * Provides a bare UniversalCamera so the scene renders before the real
 * first-person controller lands.
 */
import { UniversalCamera, Vector3 } from '@babylonjs/core';
import type { InputManager } from '../core/InputManager';
import type { IGameContext, IPlayerSystem, Matrix4Like, SpawnTransform } from '../core/types';

export class PlayerSystem implements IPlayerSystem {
  readonly name = 'player';
  private ctx!: IGameContext;
  private cam!: UniversalCamera;

  constructor(private readonly input: InputManager) {
    void this.input;
  }

  get camera(): UniversalCamera {
    return this.cam;
  }
  get position(): Vector3 {
    return this.cam.position;
  }
  get velocity(): Vector3 {
    return Vector3.Zero();
  }
  get isGrounded(): boolean {
    return true;
  }

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.cam = new UniversalCamera('playerCamera', new Vector3(0, 1.7, 0), ctx.scene);
    this.cam.minZ = 0.05;
    ctx.scene.activeCamera = this.cam;
  }

  update(_dtSeconds: number): void {
    void this.ctx;
  }

  teleportThroughPortal(_worldTransform: Matrix4Like, _linkedNormal: Vector3): void {}
  placeAt(spawn: SpawnTransform): void {
    this.cam.position.set(spawn.position.x, spawn.position.y, spawn.position.z);
  }
  setActive(_active: boolean): void {}
  launch(_velocity: Vector3): void {}
  addExternalVelocity(_velocity: Vector3): void {}
  dispose(): void {
    this.cam?.dispose();
  }
}
