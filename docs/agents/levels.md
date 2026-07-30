# levels — LevelSystem (src/levels/**)

GOAL: the chamber builder + a 6-chamber campaign that teaches like Portal and
escalates like Portal 2. Replace the stub in `src/levels/LevelSystem.ts`
(keep class name + `new LevelSystem(save: SaveSystem)`).

## Implement ILevelSystem exactly

`loadLevel(i)` / `restartLevel()` / `currentLevelIndex` / `levelCount` /
`unlockedLevelIndex` (from the SaveSystem) / `getLevelList()` / `update(dt)` /
`dispose()`.

## ChamberBuilder (src/levels/ChamberBuilder.ts)

Builds a chamber shell from a `ChamberDefinition`:

- Floor/walls/ceiling as 2m panel tiles (`CONFIG.levels.panelSize`,
  `panelThickness`) using `ctx.systems.rendering.materials` —
  `wallPanel(portalable)`, `floorPanel()`, `ceilingPanel()`. Default: walls
  portalable, floor/ceiling portalable, EXCEPT where `SurfaceOverride`s say
  otherwise (overrides are in panel units per wall — honor exactly).
- PERFORMANCE: merge/Instance panels (thousands of draw calls = reject).
  BUT physics + portal raycasts need per-region metadata, so: build INVISIBLE
  physics proxy boxes (`physics.createStaticBox`) per contiguous run of
  same-portalability panels, each proxy mesh carrying
  `metadata.portalable` + `metadata.panelSize = { width, height }` of the run
  (portal placement validates run size). Proxies `isVisible = false`.
- Chamber dressing: ceiling light fixtures (emissive strips + the rendering
  system's mood lighting), trim skirting, an observation-room glass facade on
  one wall, chamber signage (DynamicTexture: chamber number + Portal-style
  hazard/pictogram icons drawn with canvas paths), subtle panel jitter/rotation
  for `damaged` mood. Call `rendering.setMood(definition.mood ?? 'clean')`.
- Entry airlock + exit door frame; the `exit-elevator` element (puzzle system
  builds it from the spec — you place the spec, not the mesh).
- Everything parented to one `chamberRoot`; disposed on next load
  (`puzzle.clearChamber()` handles elements; you handle the shell + proxies).

## Campaign (src/levels/chambers/*.ts — one file per chamber, data only)

Six chambers, dimensions in whole panel multiples, spawn inside, every link
target existing, solvable. Arc:

1. `00-awakening` ("Test Chamber 00", clean): teach look/move; a pit crossed
   by firing a portal; exit elevator. introLines set the fiction.
2. `01-cubes` (clean): dispenser + weighted cube + floor button + door.
3. `02-momentum` (clean): fling across a goo pit — floor portal at the bottom
   of a drop, exit portal high on a wall.
4. `03-faith` (damaged): faith plates + portals + a light bridge.
5. `04-lasers` (damaged): laser emitter/receiver routed through portals;
   relay; glass.
6. `05-funnels` (dark): excursion funnel + bridges + everything combined;
   finale elevator.

Each chamber: `name`, `tagline`, `introLines` (2–4 dry Aperture announcer
lines), `hint`, sensible `mood`. Portals are always available — never require
a pre-placed portal.

## Flow

- `loadLevel(i)`: emit `level:loading`; `puzzle.clearChamber()`; dispose
  previous shell; build shell; `puzzle.buildChamber(def)`; `player.placeAt
  (def.spawn)`; `rendering.setMood`; `audio.setMusicState` (calm early, tense
  late); play `introLines` as `ui:subtitle` events (staggered ~3.5s);
  `ambient.hum` loop; emit `level:loaded`.
- Completion: subscribe `element:activated`; when the id is the chamber's
  `exit-elevator` id → `chamber.complete` sound, `elevator.loop`,
  `audio.setMusicState('chamber-complete')`, emit `level:completed
  { levelIndex, levelId, timeMs: 0 }` (Game owns timing/save/advance).
- `restartLevel()`: reload current index.
- Hint timer: after `CONFIG.levels.hintDelaySeconds` without completion,
  emit `ui:hint { text: def.hint }` once.
- `getLevelList()`: from SaveSystem (`unlockedLevelIndex`, `isCompleted`).

## Validator + tests (src/levels/*.test.ts)

Write a pure `validateChamber(def)` (sizes are whole panel multiples; spawn
inside bounds; element ids unique; links reference existing ids; exactly one
exit-elevator; overrides in range) and TEST THAT ALL SIX CHAMBERS PASS. Add
tests for the panel-run/proxy layout math.
