/**
 * STUB — replaced by the physics subsystem agent (Havok world).
 */
import { Quaternion, Vector3 } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import type {
  BoxBodyOptions,
  IGameContext,
  IPhysicsSystem,
  PhysicsBodyHandle,
  PhysicsHit,
  StaticBoxOptions,
  TeleportableInfo,
} from '../core/types';

export class PhysicsSystem implements IPhysicsSystem {
  readonly name = 'physics';

  init(_ctx: IGameContext): void {}
  update(_dtSeconds: number): void {}
  raycast(_origin: Vector3, _direction: Vector3, _maxDistance: number): PhysicsHit | null {
    return null;
  }
  setGravity(_gravity: Vector3): void {}
  createStaticBox(_options: StaticBoxOptions): PhysicsBodyHandle {
    return 'stub';
  }
  createBoxBody(_options: BoxBodyOptions): PhysicsBodyHandle {
    return 'stub';
  }
  removeBody(_handle: PhysicsBodyHandle): void {}
  applyImpulse(_handle: PhysicsBodyHandle, _impulse: Vector3): void {}
  setLinearVelocity(_handle: PhysicsBodyHandle, _velocity: Vector3): void {}
  getLinearVelocity(_handle: PhysicsBodyHandle): Vector3 {
    return Vector3.Zero();
  }
  getBodyPosition(_handle: PhysicsBodyHandle): Vector3 {
    return Vector3.Zero();
  }
  getBodyQuaternion(_handle: PhysicsBodyHandle): Quaternion {
    return Quaternion.Identity();
  }
  teleportBody(_handle: PhysicsBodyHandle, _position: Vector3, _rotation: Quaternion): void {}
  getMeshForBody(_handle: PhysicsBodyHandle): AbstractMesh | null {
    return null;
  }
  registerTeleportable(_handle: PhysicsBodyHandle, _info: { id: string; radius: number }): void {}
  unregisterTeleportable(_handle: PhysicsBodyHandle): void {}
  getTeleportables(): readonly TeleportableInfo[] {
    return [];
  }
  dispose(): void {}
}
