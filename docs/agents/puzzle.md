# puzzle — PuzzleSystem (src/puzzle/**)

GOAL: every Aperture Science test element, built and tuned like Portal 2.
Replace the stub in `src/puzzle/PuzzleSystem.ts` (keep class name +
`new PuzzleSystem()`). Implement `buildChamber(definition)` /
`clearChamber()` / `update(dt)` / `dispose()`.

## Framework

- Base `PuzzleElement` (id, spec, ctx, parent node; `update(dt)`; `dispose()`)
  + registry. `buildChamber` creates all elements under one `puzzleRoot`
  TransformNode; `clearChamber` disposes EVERYTHING (meshes, bodies, loops,
  observers) and is also called between chambers — leaks here compound.
- LINK LOGIC: sources (buttons, laser receivers/relays) emit
  `element:activated` / `element:deactivated` with their element id. A source's
  `spec.links` lists `{ targetId, invert? }`. A reactor collects incoming
  signals from every source linked to it and evaluates `require: 'all'` (AND,
  default) or `'any'` (OR); `invert` flips that source's contribution.
  Implement the solver as a pure function and test it exhaustively.
- All interactive meshes carry `metadata.elementId`; interactables carry
  `metadata.interactableId` + `metadata.interactPrompt` (the player system
  raycasts for these); glass carries `metadata.glass = true`.
- State accents: idle = orange emissive, active = cyan-blue emissive. Sounds
  via `ctx.systems.audio` with SOUND ids (docs/SOUND_IDS.md). Animations via
  `damp` (core/math.ts). Numbers from CONFIG.puzzle.

## Elements (one file each under src/puzzle/elements/)

- `button-floor`: 1500-Megawatt-style pressure plate. Depresses
  `buttonPressDepth` while a heavy-enough body (≥ `buttonTriggerMass`) or the
  player stands on it (zone check vs player position + teleportable body
  positions — no physics callbacks needed). `momentary` (default: releases
  when clear, `holdSeconds` grace), `latching` (stays). Sounds press/release.
- `button-pedestal`: standing button; E-interact via `player:interacted`;
  momentary press (~1s active) or latching per `mode`.
- `cube`: Weighted Storage Cube — `CONFIG.physics.cubeSize` box body
  (mass/damping from Config), `cubeShell` material, beveled look. Mesh
  metadata: `grabbable: true`, `bodyHandle`, `objectId` (the player carries
  via these). `physics.registerTeleportable` (radius ~0.45). Hard impacts →
  `cube.bounce` (velocity-drop threshold). `fizzle()`: dissolve animation +
  `cube.fizzle` + emit `object:fizzled`; goo contact fizzles with
  `reason: 'dispenser'` (contract-limited) so its dispenser respawns it.
- `cube-dispenser`: ceiling tube + iris door; `initialDrop` drops on build;
  listens for `object:fizzled` of ITS cube → replacement after a short delay
  (`dispenser.drop`); can also be link-activated to drop on demand.
- `door`: two sliding panels (orientation x/z), `doorOpenSeconds`,
  `require` all/any, `startsOpen`; trim frame + indicator strip; whoosh
  sounds; obstruction check while closing (player/cube in the way → reopen).
  Collision: kinematic/static blocker that follows the panels.
- `laser-emitter`: pedestal emitter; beam = `physics.raycast` along
  `direction` each frame (≤100m); glowing beam mesh (additive, animated);
  positional `laser.hum` loop. Beam stops at first solid hit; passes THROUGH
  `metadata.glass`; activates receivers/relays it hits; kills the player on
  capsule intersection (`player:died { cause: 'laser' }` + `laser.kill`).
  STRETCH: beam continues through open portals (portal pair transform) —
  attempt it, guard failures.
- `laser-receiver`: receptacle; active while a beam is on it (1-frame grace);
  powers links.
- `laser-relay`: like receiver, but the beam continues past it in the same
  direction.
- `faith-plate`: Aerial Faith Plate. On player/cube contact, launch along a
  ballistic arc to `target` (solve velocity for gravity 19.6, `power` scales
  it; pure function + tests). Player: `player.launch(v)`; cubes:
  `setLinearVelocity`. Arm-flip animation, `faithplate.launch`, cooldown.
- `funnel`: excursion funnel — emitter + volumetric beam cylinder (scrolling
  additive shader; blue push / orange pull by `polarity`), `length`,
  `funnelRadius`. Entities inside: player via `addExternalVelocity` along the
  axis × `funnelSpeed`; cubes via velocity blend. `startsActive`;
  link-toggleable; positional `funnel.loop`.
- `light-bridge`: hard-light walkway — emitter + translucent panel (scrolling
  hex/energy shader, additive edge), walkable static box body while active,
  NOT portalable; `startsActive`; link-toggleable; positional `bridge.loop`.
- `platform`: moving platform along `path` waypoints at `speed`
  (`platformDefaultSpeed`), ping-pong, `startsActive`, link-toggle. Move via
  velocity (friction carries cubes); if the player stands on it (footprint +
  height check), add the platform's velocity via `player.addExternalVelocity`.
  `platform.move` loop while moving.
- `glass`: transparent barrier pane (`size`, `orientation`), static body,
  `metadata.glass = true` (lasers pass; players/cubes/portal shots blocked).
- `goo`: deadly pool — animated toxic shader (dark, scrolling noise, emissive
  bubbles). Player contact below `gooKillDepth` → `player:died
  { cause: 'goo' }` + `goo.death`; cubes fizzle (see cube).
- `exit-elevator`: cab with doors, interior light, trim. Trigger volume: when
  the player is inside, close doors, `elevator.ding`, then emit
  `element:activated { elementId: <your id> }` ONCE (the level system maps it
  to `level:completed`).

## Tests (src/puzzle/*.test.ts)

Pure logic: link solver (AND/OR/invert/latching), button state machines,
ballistic solver, zone/overlap checks, dispenser respawn bookkeeping.
