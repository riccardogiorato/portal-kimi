/**
 * puzzle/types.ts — Internal shared types used by the puzzle subsystem.
 */
import type { TransformNode, Vector3 } from '@babylonjs/core';
import type { IGameContext } from '../core/types';

/** Surface that can dissolve anything that falls into it. */
export interface GooVolume {
  id: string;
  contains(point: Vector3): boolean;
}

/** Data passed to every puzzle element factory. */
export interface PuzzleContext {
  readonly ctx: IGameContext;
  readonly parent: TransformNode;
  /** Elements that can receive a laser beam, by element id. */
  readonly laserTargets: Map<string, LaserTarget>;
  /** Active goo pools, used by cubes during fizzle checks. */
  readonly gooVolumes: GooVolume[];
}

/** Minimum surface each element implementation must expose to PuzzleSystem. */
export interface PuzzleElement {
  readonly id: string;
  readonly spec: import('../core/types').PuzzleElementSpec;
  /** Called while a chamber is loaded. */
  update(dtSeconds: number): void;
  /** React to a link state change from the central solver. */
  setLinkState(active: boolean): void;
  /** Release every Babylon/physics/observer resource. */
  dispose(): void;
}

/** Laser-sensitive target used by laser emitters/relays. */
export interface LaserTarget extends PuzzleElement {
  /** World-space position of the receptor face. */
  getBeamTargetPosition(): Vector3;
  /** True if the beam should pass through this target rather than stop. */
  passesBeamThrough?(): boolean;
  /** Notification from an incident laser this frame. */
  onLaserHit(active: boolean): void;
}

/** Scratch vector pair stored on spatial elements. */
export interface ScratchVectors {
  readonly a: Vector3;
  readonly b: Vector3;
  readonly c: Vector3;
}

/** Helper to notify a list of observers about element lifecycle events. */
export type Unsubscriber = () => void;
