/**
 * puzzle/PuzzleElement.ts — Base class shared by every test element.
 */
import { TransformNode } from '@babylonjs/core';
import type { AbstractMesh, Scene } from '@babylonjs/core';
import type {
  GameEventMap,
  IGameContext,
  PhysicsBodyHandle,
  PuzzleElementSpec,
} from '../core/types';
import type { EventBus } from '../core/EventBus';
import type { PuzzleContext, Unsubscriber } from './types';
import type { PuzzleMaterials } from './materials';

export abstract class BasePuzzleElement<TSpec extends PuzzleElementSpec> {
  readonly id: string;
  readonly spec: TSpec;
  readonly ctx: IGameContext;
  readonly node: TransformNode;
  readonly materials: PuzzleMaterials;
  /** Current output of the link solver for this element; subclasses may read. */
  linkActive = false;

  private readonly _puzzleContext: PuzzleContext;
  private _disposed = false;
  private readonly _unsubscribers: Unsubscriber[] = [];
  private readonly _meshes: AbstractMesh[] = [];
  private readonly _bodyHandles: PhysicsBodyHandle[] = [];

  constructor(id: string, spec: TSpec, context: PuzzleContext, materials: PuzzleMaterials) {
    this.id = id;
    this.spec = spec;
    this._puzzleContext = context;
    this.ctx = context.ctx;
    this.materials = materials;
    const scene = this.ctx.scene;
    this.node = new TransformNode(`puzzle-${id}`, scene);
    this.node.parent = context.parent;
    this.node.position.set(spec.position.x, spec.position.y, spec.position.z);
    this.node.rotationQuaternion = null;
  }

  /** Internal subsystem data used by laser targets, goo volumes, etc. */
  protected get puzzle(): PuzzleContext {
    return this._puzzleContext;
  }

  /** True after dispose() has run, used by PuzzleSystem to clean up fizzled cubes. */
  get disposed(): boolean {
    return this._disposed;
  }

  get scene(): Scene {
    return this.ctx.scene;
  }

  get events(): EventBus {
    return this.ctx.events;
  }

  /** Override per-frame logic. */
  abstract update(dtSeconds: number): void;

  /** React to the link solver's result. Default is a no-op for source-only elements. */
  setLinkState(active: boolean): void {
    if (this.linkActive === active) return;
    this.linkActive = active;
    this.onLinkState(active);
  }

  protected onLinkState(_active: boolean): void {
    // Most source-only elements ignore link state.
  }

  /** Helper: emit element:activated when a source turns on. */
  protected emitActivated(): void {
    if (this._disposed) return;
    this.ctx.events.emit('element:activated', { elementId: this.id });
  }

  /** Helper: emit element:deactivated when a source turns off. */
  protected emitDeactivated(): void {
    if (this._disposed) return;
    this.ctx.events.emit('element:deactivated', { elementId: this.id });
  }

  /** Type-safe subscription that auto-unsubscribes on element destruction. */
  protected on<K extends keyof GameEventMap>(
    event: K,
    handler: (payload: GameEventMap[K]) => void,
  ): void {
    this._unsubscribers.push(this.ctx.events.on(event, handler));
  }

  /** Track a mesh so it is disposed with this element and tag it with elementId. */
  protected track(mesh: AbstractMesh): void {
    mesh.metadata = { ...mesh.metadata, elementId: this.id };
    mesh.parent = this.node;
    this._meshes.push(mesh);
  }

  /** Track a physics body so it is removed on disposal. */
  protected trackBody(handle: PhysicsBodyHandle): void {
    this._bodyHandles.push(handle);
  }

  /** Untrack a mesh without disposing the whole element (used by fizzling cubes). */
  protected untrackMesh(mesh: AbstractMesh): void {
    const idx = this._meshes.indexOf(mesh);
    if (idx >= 0) this._meshes.splice(idx, 1);
  }

  /** Untrack a body removed by fizzle, so dispose() does not double-remove. */
  protected untrackBody(handle: PhysicsBodyHandle): void {
    const idx = this._bodyHandles.indexOf(handle);
    if (idx >= 0) this._bodyHandles.splice(idx, 1);
  }

  /** Descendants may override to release extra resources before the base cleanup. */
  protected beforeDispose(): void {
    // no-op by default
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.beforeDispose();

    for (const unsub of this._unsubscribers) {
      unsub();
    }
    this._unsubscribers.length = 0;

    const physics = this.ctx.systems.physics;
    for (const handle of this._bodyHandles) {
      physics.removeBody(handle);
    }
    this._bodyHandles.length = 0;

    for (const mesh of this._meshes) {
      mesh.dispose(true, false); // avoid double-disposing children that are also tracked
    }
    this._meshes.length = 0;

    this.node.dispose(true, false);
  }
}
