/**
 * physics/physics.test.ts — REAL integration tests: Havok wasm runs headless
 * in Node against a NullEngine scene. No mocks for the physics itself.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import HavokPhysics from '@babylonjs/havok';
import type { IGameContext } from '../core/types';
import { PhysicsSystem } from './PhysicsSystem';
import { BodyRegistry } from './BodyRegistry';

let engine: NullEngine;
let scene: Scene;
let physics: PhysicsSystem;

function fakeContext(s: Scene): IGameContext {
  return { scene: s } as unknown as IGameContext;
}

function step(frames = 10): void {
  for (let i = 0; i < frames; i++) scene.render();
}

beforeAll(async () => {
  const wasmPath = join(__dirname, '../../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm');
  // Buffer is an ArrayBufferView; emscripten accepts it as wasmBinary at runtime.
  PhysicsSystem.injectedHavok = await HavokPhysics({ wasmBinary: readFileSync(wasmPath) as unknown as ArrayBuffer });
});

beforeEach(async () => {
  engine = new NullEngine();
  scene = new Scene(engine);
  scene.gravity = new Vector3(0, -19.6, 0);
  // NullEngine measures wall-clock deltas (µs between renders) — far too
  // little sim time per frame. Pin a deterministic 60 Hz delta instead.
  engine.getDeltaTime = () => 1000 / 60;
  // scene.render() (which steps physics) requires an active camera.
  new FreeCamera('testCam', new Vector3(0, 1, -5), scene);
  physics = new PhysicsSystem();
  await physics.init(fakeContext(scene));
});

describe('PhysicsSystem (real Havok)', () => {
  it('initializes and reports ready', () => {
    expect(physics.isReady).toBe(true);
  });

  it('double-init is a no-op', async () => {
    await physics.init(fakeContext(scene));
    expect(physics.isReady).toBe(true);
  });

  it('dynamic body falls under gravity; static box does not', () => {
    const floor = physics.createStaticBox({ id: 'floor', size: new Vector3(20, 1, 20), position: new Vector3(0, -0.5, 0) });
    const cube = physics.createBoxBody({ id: 'cube', size: new Vector3(0.6, 0.6, 0.6), position: new Vector3(0, 5, 0), mass: 10 });
    step(30);
    expect(physics.getBodyPosition(cube).y).toBeLessThan(5);
    expect(physics.getBodyPosition(floor).y).toBe(-0.5);
  });

  it('falling cube lands and rests on the static floor', () => {
    physics.createStaticBox({ id: 'floor', size: new Vector3(20, 1, 20), position: new Vector3(0, -0.5, 0) });
    const cube = physics.createBoxBody({ id: 'cube', size: new Vector3(1, 1, 1), position: new Vector3(0, 3, 0), mass: 10 });
    step(180); // 3s of sim: falls ~0.55s, then settles
    const y = physics.getBodyPosition(cube).y;
    // Half extents 0.5 + floor top 0 → rest near y=0.5 (allow sink tolerance).
    expect(y).toBeGreaterThan(0.2);
    expect(y).toBeLessThan(0.9);
  });

  it('raycast straight down hits the floor with correct point/normal/distance', () => {
    const floor = physics.createStaticBox({ id: 'floor', size: new Vector3(20, 1, 20), position: new Vector3(0, -0.5, 0) });
    const hit = physics.raycast(new Vector3(0, 5, 0), new Vector3(0, -1, 0), 100);
    expect(hit).not.toBeNull();
    expect(hit!.point.y).toBeCloseTo(0, 1);
    expect(hit!.normal.y).toBeCloseTo(1, 3);
    expect(hit!.distance).toBeCloseTo(5, 1);
    expect(hit!.bodyHandle).toBe(floor);
    expect(hit!.mesh).not.toBeNull();
  });

  it('raycast that misses returns null', () => {
    physics.createStaticBox({ id: 'floor', size: new Vector3(2, 1, 2), position: new Vector3(0, -0.5, 0) });
    expect(physics.raycast(new Vector3(50, 5, 0), new Vector3(0, -1, 0), 10)).toBeNull();
  });

  it('teleportBody moves instantly and preserves velocity', () => {
    const cube = physics.createBoxBody({ id: 'cube', size: new Vector3(1, 1, 1), position: new Vector3(0, 5, 0), mass: 1 });
    physics.setLinearVelocity(cube, new Vector3(3, 0, 0));
    physics.teleportBody(cube, new Vector3(10, 2, -4), Quaternion.Identity());
    step(1);
    const pos = physics.getBodyPosition(cube);
    expect(pos.x).toBeGreaterThan(9); // teleported to 10, may drift with velocity
    const vel = physics.getLinearVelocity(cube);
    expect(vel.x).toBeCloseTo(3, 1);
  });

  it('removeBody is idempotent and unknown handles no-op safely', () => {
    const cube = physics.createBoxBody({ id: 'cube', size: new Vector3(1, 1, 1), position: new Vector3(0, 5, 0), mass: 1 });
    physics.removeBody(cube);
    physics.removeBody(cube); // second call must not throw
    physics.setLinearVelocity('nope', new Vector3(1, 0, 0));
    physics.applyImpulse('nope', new Vector3(1, 0, 0));
    physics.teleportBody('nope', Vector3.Zero(), Quaternion.Identity());
    expect(physics.getMeshForBody('nope')).toBeNull();
  });

  it('teleportable registry round-trips and reports idle time', () => {
    const cube = physics.createBoxBody({ id: 'cube', size: new Vector3(1, 1, 1), position: new Vector3(0, 5, 0), mass: 1 });
    physics.registerTeleportable(cube, { id: 'cube-1', radius: 0.45 });
    expect(physics.getTeleportables()).toHaveLength(1);
    expect(physics.getTeleportables()[0]).toMatchObject({ handle: cube, id: 'cube-1', radius: 0.45 });
    physics.update(1 / 60);
    expect(physics.getIdleSeconds(cube)).toBeGreaterThanOrEqual(0);
    physics.unregisterTeleportable(cube);
    expect(physics.getTeleportables()).toHaveLength(0);
  });

  it('raycast before dispose safety: methods survive dispose', () => {
    physics.dispose();
    expect(() => physics.removeBody('x')).not.toThrow();
  });
});

describe('BodyRegistry (pure)', () => {
  it('registers, looks up by body, and removes', () => {
    const registry = new BodyRegistry();
    const fakeBody = {} as never;
    const handle = registry.register(fakeBody, null);
    expect(registry.get(handle)?.body).toBe(fakeBody);
    expect(registry.handleForBody(fakeBody)).toBe(handle);
    expect(registry.remove(handle)?.handle).toBe(handle);
    expect(registry.remove(handle)).toBeUndefined();
  });

  it('teleportable list is stable between mutations (no per-frame garbage)', () => {
    const registry = new BodyRegistry();
    const a = registry.register({} as never, null);
    registry.setTeleportable(a, { id: 'a', radius: 1 });
    const first = registry.teleportables();
    const second = registry.teleportables();
    expect(first).toBe(second); // same array instance until dirty
    registry.clearTeleportable(a);
    expect(registry.teleportables()).not.toBe(first);
    expect(registry.teleportables()).toHaveLength(0);
  });
});
