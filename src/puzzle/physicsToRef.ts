/**
 * puzzle/physicsToRef.ts — Type cast to access the zero-allocation Havok helpers
 * exposed by PhysicsSystem without touching the shared core interface.
 */
import type { Vector3 } from '@babylonjs/core';
import type { IPhysicsSystem, PhysicsBodyHandle } from '../core/types';

export interface IPhysicsSystemWithToRef extends IPhysicsSystem {
  getBodyPositionToRef(handle: PhysicsBodyHandle, out: Vector3): boolean;
  getLinearVelocityToRef(handle: PhysicsBodyHandle, out: Vector3): boolean;
}

export function withToRef(physics: IPhysicsSystem): IPhysicsSystemWithToRef {
  return physics as IPhysicsSystemWithToRef;
}
