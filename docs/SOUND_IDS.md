# Sound ID Registry (shared vocabulary)

Audio owns implementation (`src/audio/`); every other system triggers by ID via
`ctx.systems.audio.play(id)` / `playAt(id, position)` / `startLoop(id, position?)`.
Unknown IDs must warn once and no-op — never throw.

| ID | Kind | Triggered by |
|---|---|---|
| portal.fire.blue / portal.fire.orange | one-shot | portals: gun fired |
| portal.open | one-shot | portals: placement succeeded |
| portal.close | one-shot | portals: portal cleared/replaced |
| portal.fizzle | one-shot | portals: placement failed |
| portal.enter | one-shot | portals: player teleported |
| object.teleport | one-shot | portals: object teleported |
| button.press / button.release | one-shot | puzzle: floor/pedestal buttons |
| door.open / door.close | one-shot | puzzle: doors |
| cube.pickup / cube.drop / cube.bounce / cube.fizzle | one-shot | puzzle: cubes |
| dispenser.drop | one-shot | puzzle: cube dispenser |
| laser.hum | loop | puzzle: laser emitter (positional) |
| laser.hit | one-shot | puzzle: laser hits player |
| faithplate.launch | one-shot | puzzle: faith plate fires |
| funnel.hum | loop | puzzle: excursion funnel (positional) |
| bridge.hum | loop | puzzle: light bridge (positional) |
| platform.move | loop | puzzle: moving platform while moving |
| goo.splash | one-shot | puzzle: something enters goo |
| player.jump / player.land | one-shot | player |
| player.step | one-shot | player: footstep (pitch-varied) |
| player.die | one-shot | player: any death |
| elevator.move | loop | levels: elevator ride |
| elevator.ding | one-shot | levels: arrival |
| ui.click / ui.hover / ui.pause | one-shot | ui |
| chamber.complete | one-shot | levels: exit reached |
| ambient.chamber | loop | levels: room tone per chamber |

## Cross-subsystem conventions

- **Exit elevator**: the puzzle elevator element emits `element:activated` with its
  own element id when the player enters the trigger volume. The level system maps
  that id to `level:completed`.
- **Mesh metadata**: `metadata.portalable` (boolean) on wall panels;
  `metadata.panelSize = { width, height }` on panels; `metadata.interactableId` +
  `metadata.interactPrompt` on interactables; `metadata.glass = true` on glass
  (laser beams pass, players/cubes/portal shots are blocked);
  `metadata.elementId` on puzzle element meshes.
- **Portal layer masks**: default geometry `0x0FFFFFFF`; blue portal surface
  `0x20000000`; orange portal surface `0x40000000`. Main camera sees all three;
  each portal's RTT camera excludes its own surface layer.
