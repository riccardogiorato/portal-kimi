/**
 * physics/BodyRegistry.ts — Handle bookkeeping for physics bodies.
 *
 * Pure data structure, no Babylon scene dependencies: fully unit-testable.
 * The portal system scans teleportables every frame, so the teleportable
 * list is rebuilt only when dirty (no per-frame allocation).
 */
import type { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody';
import type { AbstractMesh } from '@babylonjs/core';
import type { PhysicsBodyHandle, TeleportableInfo } from '../core/types';

export interface BodyRecord {
  readonly handle: PhysicsBodyHandle;
  readonly body: PhysicsBody;
  readonly mesh: AbstractMesh | null;
  /** Last update() timestamp (seconds) at which the body was seen moving. */
  lastActiveTime: number;
  teleportable: { id: string; radius: number } | null;
}

export class BodyRegistry {
  private readonly records = new Map<PhysicsBodyHandle, BodyRecord>();
  private readonly bodyToHandle = new WeakMap<PhysicsBody, PhysicsBodyHandle>();
  private counter = 0;
  private teleportablesDirty = true;
  private cachedTeleportables: TeleportableInfo[] = [];

  register(body: PhysicsBody, mesh: AbstractMesh | null): PhysicsBodyHandle {
    const handle = `body-${++this.counter}`;
    this.records.set(handle, { handle, body, mesh, lastActiveTime: 0, teleportable: null });
    this.bodyToHandle.set(body, handle);
    return handle;
  }

  get(handle: PhysicsBodyHandle): BodyRecord | undefined {
    return this.records.get(handle);
  }

  handleForBody(body: PhysicsBody | undefined): PhysicsBodyHandle | null {
    if (!body) return null;
    return this.bodyToHandle.get(body) ?? null;
  }

  /** Removes and returns the record (caller disposes the body). Idempotent. */
  remove(handle: PhysicsBodyHandle): BodyRecord | undefined {
    const record = this.records.get(handle);
    if (!record) return undefined;
    this.records.delete(handle);
    if (record.teleportable) this.teleportablesDirty = true;
    return record;
  }

  setTeleportable(handle: PhysicsBodyHandle, info: { id: string; radius: number }): boolean {
    const record = this.records.get(handle);
    if (!record) return false;
    record.teleportable = info;
    this.teleportablesDirty = true;
    return true;
  }

  clearTeleportable(handle: PhysicsBodyHandle): void {
    const record = this.records.get(handle);
    if (record?.teleportable) {
      record.teleportable = null;
      this.teleportablesDirty = true;
    }
  }

  /** Stable array instance between mutations — safe to hold across frames. */
  teleportables(): readonly TeleportableInfo[] {
    if (this.teleportablesDirty) {
      this.cachedTeleportables = [];
      for (const record of this.records.values()) {
        if (record.teleportable) {
          this.cachedTeleportables.push({ handle: record.handle, id: record.teleportable.id, radius: record.teleportable.radius });
        }
      }
      this.teleportablesDirty = false;
    }
    return this.cachedTeleportables;
  }

  get size(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
    this.cachedTeleportables = [];
    this.teleportablesDirty = true;
  }
}
