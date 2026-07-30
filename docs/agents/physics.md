# physics — PhysicsSystem (src/physics/**)

GOAL: rock-solid Havok v2 physics — the foundation every other system stands
on. Replace the stub in `src/physics/PhysicsSystem.ts` (keep class name +
constructor `new PhysicsSystem()`).

## Init

- `import HavokPhysics from '@babylonjs/havok'`; the wasm is served at
  `${import.meta.env.BASE_URL}HavokPhysics.wasm` (copied into `public/` by
  `scripts/copy-wasm.mjs`) → `await HavokPhysics({ locateFile: () => ... })`.
  Verify the exact export shape in `node_modules/@babylonjs/havok/dist/**/*.d.ts`.
- `scene.enablePhysics(scene.gravity, new HavokPlugin(true, havok))` —
  Game.ts already set `scene.gravity` to `(0, CONFIG.physics.gravityY, 0)` with
  `gravityY = -19.6` (already signed). Do NOT re-negate.
- `init()` may be async (interface allows Promise). Guard against double-init.

## Implement IPhysicsSystem exactly

- Body registry: Map handle → { body/aggregate, mesh, teleportable? }. Unique
  string handles. Reverse map PhysicsBody → handle for raycast hits
  (body.pluginData or a WeakMap — check what v9 allows).
- `createStaticBox` / `createBoxBody`: PhysicsAggregate (BOX shape) or
  Body+Shape directly; correct motion types; mass/damping/restitution/friction
  from options; attach `options.mesh` as the body's transformNode.
- `raycast(origin, direction, maxDistance)`: use the v2 physics raycast
  (PhysicsRaycastResult — check the d.ts for the exact v9 API); return
  PhysicsHit { point, normal, distance, mesh (body.transformNode), bodyHandle }.
  Must hit static proxies AND dynamic bodies. Null before init / on no hit.
- `applyImpulse` / `setLinearVelocity` / `getLinearVelocity` /
  `getBodyPosition` / `getBodyQuaternion`: correct thin wrappers. The portal
  system calls getters every frame — prefer no-allocation out-param variants on
  your concrete class (keep interface behavior intact) and note them in your report.
- `teleportBody(handle, position, rotation)`: instant move Havok respects —
  set transformNode position/rotationQuaternion with `body.disablePreStep = false`
  (verify the v9 pattern in the d.ts). Do NOT zero velocity — portal travel
  preserves momentum; callers manage velocity.
- `removeBody`: idempotent; dispose body+shape; unregister teleportable;
  do NOT dispose the mesh (its owner does).
- `registerTeleportable` / `unregisterTeleportable` / `getTeleportables`.
- `setGravity`: scene.gravity + engine gravity.
- `update(dt)`: minimal — Havok steps with `scene.render()`; housekeeping only.

## Robustness

- Every public method safe before init / after dispose / on unknown handle
  (warn once, no-op — never throw across system boundaries).
- On your concrete class, expose whatever Babylon 9 offers for shape-cast /
  overlap queries (check the d.ts: `castShape`? `overlapQuery`?) — the player
  system wants it for capsule support checks. Note what exists in your report.

## Tests (src/physics/*.test.ts)

@babylonjs/havok runs headless in Node — prefer REAL integration tests:
NullEngine + Scene + your system, create bodies, step, raycast, teleport,
verify. If NullEngine proves impractical, fall back to pure-logic tests
(registry bookkeeping, option sanitization) with a comment explaining why.
