# player — PlayerSystem (src/player/**)

GOAL: a first-person controller that feels like Portal 2 — weighty movement,
snappy portals-grade air control, perfect camera. Replace the stub in
`src/player/PlayerSystem.ts` (keep class name + constructor
`new PlayerSystem(input: InputManager)`).

## Implement IPlayerSystem exactly

`camera` (UniversalCamera), `position`, `velocity`, `isGrounded`,
`teleportThroughPortal(worldTransform, linkedNormal)`, `placeAt(spawn)`,
`setActive(active)`, `launch(velocity)`, `addExternalVelocity(velocity)`,
`update(dt)`, `dispose()`.

## Movement (all numbers from CONFIG.player)

- Use Babylon 9's `PhysicsCharacterController` (check
  `node_modules/@babylonjs/core/**/*.d.ts` for the exact API: capsule shape,
  `checkSupportForStepping`, max slope, `setVelocity`/`integrate`…). Physics is
  enabled on the scene before your init runs (init order in Game.ts). If the
  controller API falls short, build a kinematic capsule on
  `ctx.systems.physics.raycast` — your choice, must be robust.
- Walk/sprint/crouch speeds, acceleration/friction model (ground accel vs
  airAcceleration), gravity from Config (game-tuned 19.6), jump with
  ~0.12s coyote time + ~0.15s jump buffer.
- Crouch: capsule height 1.8→1.25 (damped), crouchSpeed, stand-up blocked
  check (raycast up) so you never stand into a ceiling.
- Step height + max slope from Config.

## Camera feel

- Yaw/pitch from `input.consumeMouseDelta()` × `settings.mouseSensitivity` ×
  `CONFIG.player.mouseBaseSensitivity`; `invertY` support; pitch clamp
  ±CONFIG pitchLimitDegrees. FOV from `settings.fovDegrees`; react live to
  `settings:changed`.
- Sprint FOV kick (+~4°, damped). Head bob when grounded and moving
  (Config frequency/amplitude; sinusoidal, subtle roll). Landing kick
  proportional to impact speed; above `landShakeThreshold` also call
  `ctx.systems.rendering.shake(...)` and emit `player:landed`.
- Emit `player:step` (with speed) at bob-cycle footfall points for audio.

## Interaction + carrying (cross-system conventions — follow EXACTLY)

- Every ~0.1s (not every frame): `physics.raycast` from camera forward,
  `CONFIG.player.interactDistance`.
- Hit mesh with `metadata.interactableId` → emit `player:interactPrompt`
  `{ text: metadata.interactPrompt }` ON CHANGE ONLY (null when nothing);
  on `interact` press emit `player:interacted { targetId }`.
- Hit mesh with `metadata.grabbable === true` (+ `metadata.bodyHandle`,
  `metadata.objectId`) → prompt "[E] Pick up"; on `interact` press, carry it:
  hold point = camera + forward × `carryDistance`; drive the body with
  `physics.setLinearVelocity` toward the hold point (velocity-based carry,
  `carryLerp` rate, clamped max speed) — never teleport a carried body per
  frame. While carried: emit `object:grabbed`. On second `interact` press:
  release — `object:released { thrown }`; thrown=true with a forward impulse
  (`throwImpulse`) when the player is moving fast, else a gentle drop.
  Firing portals while carrying must keep working (don't eat mouse input).
- Drop the carried object if it gets too far from the hold point (yank-out
  through walls) or if the player dies/teleports.

## Portal travel

- `teleportThroughPortal(worldTransform: Matrix4Like, linkedNormal)`: rebuild
  a Matrix (`Matrix.FromArray`), transform position with
  `Vector3.TransformCoordinates`, velocity with `transformDirectionThroughPortal`
  (core/math.ts), recompute yaw/pitch from the transformed forward vector.
  Preserve speed EXACTLY ("speedy thing goes in, speedy thing comes out").
  Add `CONFIG.portals.exitNudge` along linkedNormal. Handle the character
  controller correctly across the teleport (disable/re-enable or setPosition —
  check d.ts). Zero per-frame allocation here: reuse scratch objects.

## Misc

- `placeAt(spawn)`: set position + yaw, zero velocity, emit `player:spawned`.
- `setActive(false)`: ignore input, freeze controller (menus/death).
- `launch(velocity)`: set velocity outright (faith plates).
- `addExternalVelocity(v)`: accumulate; applied in next `update` then cleared
  (excursion funnels call this every frame).
- Death: if `position.y < -30` emit `player:died { cause: 'fall' }` (once per
  descent, re-arm on spawn).

## Tests (src/player/*.test.ts)

Pure logic in a separate module (e.g. `movementMath.ts`): look-angle math,
coyote/buffer timers, carry-velocity solver, bob phase, FOV kick, yaw/pitch
reconstruction after portal transforms. Test them thoroughly.
