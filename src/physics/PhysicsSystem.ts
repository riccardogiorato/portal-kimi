/**
 * physics/PhysicsSystem.ts — Havok v2 physics foundation.
 *
 * Owns the wasm-loaded Havok plugin, the body registry, raycasts and all
 * body manipulation other systems need (portals, player, puzzle, levels).
 *
 * Robustness contract: every public method is safe before init, after
 * dispose, and on unknown handles — it warns once and no-ops rather than
 * throwing across a system boundary.
 */
import { MeshBuilder, PhysicsAggregate, Quaternion, Vector3 } from '@babylonjs/core';
import { PhysicsShapeType, PhysicsMotionType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { PhysicsRaycastResult } from '@babylonjs/core/Physics/physicsRaycastResult';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import type { AbstractMesh, Scene } from '@babylonjs/core';
import type { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody';
import HavokPhysics from '@babylonjs/havok';
import type {
  BoxBodyOptions,
  IGameContext,
  IPhysicsSystem,
  PhysicsBodyHandle,
  PhysicsHit,
  StaticBoxOptions,
  TeleportableInfo,
} from '../core/types';
import { BodyRegistry } from './BodyRegistry';

/** Squared speed below which a body counts as idle for teleport scans. */
const IDLE_SPEED_SQUARED = 0.0004; // 0.02 m/s

export class PhysicsSystem implements IPhysicsSystem {
  readonly name = 'physics';

  /**
   * Test hook: when set, init() uses this Havok module instead of loading the
   * wasm over the network (Node/vitest has no fetch for file URLs).
   */
  static injectedHavok: unknown = null;

  private scene!: Scene;
  private plugin: HavokPlugin | null = null;
  private readonly registry = new BodyRegistry();
  private readonly rayResult = new PhysicsRaycastResult();
  private readonly rayEnd = Vector3.Zero();
  private readonly scratchVelocity = Vector3.Zero();
  private readonly warnedMessages = new Set<string>();
  private elapsedSeconds = 0;
  private disposed = false;

  get isReady(): boolean {
    return this.plugin !== null && !this.disposed;
  }

  /** Direct access for advanced consumers (character controller support). */
  get havokPlugin(): HavokPlugin | null {
    return this.plugin;
  }

  async init(ctx: IGameContext): Promise<void> {
    if (this.plugin) return; // double-init guard
    this.scene = ctx.scene;
    const havok =
      PhysicsSystem.injectedHavok ??
      (await HavokPhysics({
        locateFile: () => `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}HavokPhysics.wasm`,
      }));
    this.plugin = new HavokPlugin(true, havok as never);
    // Game.ts already set scene.gravity to the SIGNED CONFIG value — pass through.
    this.scene.enablePhysics(this.scene.gravity, this.plugin);
  }

  update(dtSeconds: number): void {
    this.elapsedSeconds += dtSeconds;
    // Track per-body activity so portal scans can skip long-idle bodies.
    const teleportables = this.registry.teleportables();
    for (let i = 0; i < teleportables.length; i++) {
      const record = this.registry.get(teleportables[i].handle);
      if (!record) continue;
      record.body.getLinearVelocityToRef(this.scratchVelocity);
      if (this.scratchVelocity.lengthSquared() > IDLE_SPEED_SQUARED) {
        record.lastActiveTime = this.elapsedSeconds;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Raycast
  // -------------------------------------------------------------------------

  raycast(origin: Vector3, direction: Vector3, maxDistance: number): PhysicsHit | null {
    if (!this.plugin) return null;
    direction.scaleToRef(maxDistance, this.rayEnd);
    this.rayEnd.addInPlace(origin);
    this.plugin.raycast(origin, this.rayEnd, this.rayResult);
    if (!this.rayResult.hasHit) return null;
    const body = this.rayResult.body;
    // The result object is reused next call — clone the data out.
    return {
      point: this.rayResult.hitPointWorld.clone(),
      normal: this.rayResult.hitNormalWorld.clone(),
      distance: this.rayResult.hitDistance,
      mesh: (body?.transformNode as AbstractMesh | undefined) ?? null,
      bodyHandle: this.registry.handleForBody(body),
    };
  }

  setGravity(gravity: Vector3): void {
    if (!this.scene) return;
    this.scene.gravity.copyFrom(gravity);
    this.scene.getPhysicsEngine()?.setGravity(gravity);
  }

  // -------------------------------------------------------------------------
  // Body lifecycle
  // -------------------------------------------------------------------------

  createStaticBox(options: StaticBoxOptions): PhysicsBodyHandle {
    const mesh = MeshBuilder.CreateBox(options.id, { size: 1 }, this.scene);
    mesh.scaling.set(options.size.x, options.size.y, options.size.z);
    mesh.position.copyFrom(options.position);
    if (options.rotation) mesh.rotationQuaternion = options.rotation.clone();
    const aggregate = new PhysicsAggregate(
      mesh,
      PhysicsShapeType.BOX,
      { mass: 0, friction: options.friction ?? 0.6, restitution: 0 },
      this.scene,
    );
    aggregate.body.setMotionType(PhysicsMotionType.STATIC);
    return this.registry.register(aggregate.body, mesh);
  }

  createBoxBody(options: BoxBodyOptions): PhysicsBodyHandle {
    const mesh = options.mesh ?? MeshBuilder.CreateBox(options.id, { size: 1 }, this.scene);
    if (!options.mesh) {
      mesh.scaling.set(options.size.x, options.size.y, options.size.z);
    }
    mesh.position.copyFrom(options.position);
    if (options.rotation) mesh.rotationQuaternion = options.rotation.clone();
    const aggregate = new PhysicsAggregate(
      mesh,
      PhysicsShapeType.BOX,
      {
        mass: options.mass,
        friction: options.friction ?? 0.5,
        restitution: options.restitution ?? 0.1,
      },
      this.scene,
    );
    aggregate.body.setLinearDamping(options.linearDamping ?? 0.05);
    aggregate.body.setAngularDamping(options.angularDamping ?? 0.4);
    return this.registry.register(aggregate.body, mesh);
  }

  removeBody(handle: PhysicsBodyHandle): void {
    const record = this.registry.remove(handle);
    if (!record) return; // idempotent
    record.body.dispose();
    // The mesh is owned by its creator (levels/puzzle) — never disposed here.
  }

  // -------------------------------------------------------------------------
  // Body manipulation
  // -------------------------------------------------------------------------

  applyImpulse(handle: PhysicsBodyHandle, impulse: Vector3): void {
    const body = this.bodyFor(handle, 'applyImpulse');
    body?.applyImpulse(impulse, body.transformNode.getAbsolutePosition());
  }

  setLinearVelocity(handle: PhysicsBodyHandle, velocity: Vector3): void {
    this.bodyFor(handle, 'setLinearVelocity')?.setLinearVelocity(velocity);
  }

  getLinearVelocity(handle: PhysicsBodyHandle): Vector3 {
    const body = this.bodyFor(handle, 'getLinearVelocity');
    const out = Vector3.Zero();
    body?.getLinearVelocityToRef(out);
    return out;
  }

  /** Zero-allocation variant for hot paths (portal scans). */
  getLinearVelocityToRef(handle: PhysicsBodyHandle, out: Vector3): boolean {
    const body = this.bodyFor(handle, 'getLinearVelocityToRef');
    if (!body) return false;
    body.getLinearVelocityToRef(out);
    return true;
  }

  getBodyPosition(handle: PhysicsBodyHandle): Vector3 {
    const body = this.bodyFor(handle, 'getBodyPosition');
    return body ? body.transformNode.getAbsolutePosition().clone() : Vector3.Zero();
  }

  /** Zero-allocation variant for hot paths. */
  getBodyPositionToRef(handle: PhysicsBodyHandle, out: Vector3): boolean {
    const body = this.bodyFor(handle, 'getBodyPositionToRef');
    if (!body) return false;
    out.copyFrom(body.transformNode.getAbsolutePosition());
    return true;
  }

  getBodyQuaternion(handle: PhysicsBodyHandle): Quaternion {
    const body = this.bodyFor(handle, 'getBodyQuaternion');
    const node = body?.transformNode;
    return node?.absoluteRotationQuaternion ? node.absoluteRotationQuaternion.clone() : Quaternion.Identity();
  }

  teleportBody(handle: PhysicsBodyHandle, position: Vector3, rotation: Quaternion): void {
    const body = this.bodyFor(handle, 'teleportBody');
    if (!body) return;
    const node = body.transformNode;
    // disablePreStep=false makes Havok adopt the new transform THIS frame —
    // the documented instant-teleport pattern. Velocity is preserved on
    // purpose: portal travel conserves momentum (callers manage velocity).
    body.disablePreStep = false;
    node.position.copyFrom(position);
    if (!node.rotationQuaternion) node.rotationQuaternion = Quaternion.Identity();
    node.rotationQuaternion.copyFrom(rotation);
  }

  getMeshForBody(handle: PhysicsBodyHandle): AbstractMesh | null {
    return this.registry.get(handle)?.mesh ?? null;
  }

  /** Seconds since the body was last seen moving (portal scan optimization). */
  getIdleSeconds(handle: PhysicsBodyHandle): number {
    const record = this.registry.get(handle);
    if (!record) return 0;
    return this.elapsedSeconds - record.lastActiveTime;
  }

  // -------------------------------------------------------------------------
  // Teleportable registry
  // -------------------------------------------------------------------------

  registerTeleportable(handle: PhysicsBodyHandle, info: { id: string; radius: number }): void {
    if (!this.registry.setTeleportable(handle, info)) this.warnOnce(`registerTeleportable: unknown handle ${handle}`);
  }

  unregisterTeleportable(handle: PhysicsBodyHandle): void {
    this.registry.clearTeleportable(handle);
  }

  getTeleportables(): readonly TeleportableInfo[] {
    return this.registry.teleportables();
  }

  // -------------------------------------------------------------------------

  dispose(): void {
    this.disposed = true;
    this.registry.clear();
    this.plugin = null;
    // The scene owns world teardown; Game disposes the scene after systems.
  }

  private bodyFor(handle: PhysicsBodyHandle, caller: string): PhysicsBody | null {
    const record = this.registry.get(handle);
    if (!record) {
      this.warnOnce(`${caller}: unknown handle ${handle}`);
      return null;
    }
    return record.body;
  }

  private warnOnce(message: string): void {
    if (this.warnedMessages.has(message)) return;
    this.warnedMessages.add(message);
    console.warn(`[physics] ${message}`);
  }
}
