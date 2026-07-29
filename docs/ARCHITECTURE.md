# PORTAL-KIMI — Architecture

A Portal 2-grade first-person puzzle game. Babylon.js 9 + TypeScript (strict), Vite 8,
Havok physics (WASM), zero external assets — every texture, mesh, and sound is
generated procedurally at runtime.

## Ground rules for subsystem agents

1. **Read first**: `src/core/types.ts` (contracts), `src/core/Config.ts` (tuning),
   `src/core/math.ts` (portal math), `src/core/EventBus.ts`, `src/core/InputManager.ts`.
2. **Ownership**: you may ONLY create/modify files inside your assigned directory.
   Never edit `src/core/**`, `src/main.ts`, `index.html`, `package.json`, or another
   subsystem's directory. If a contract seems insufficient, expose the capability on
   your concrete class and report it — do not patch shared files.
3. **No new dependencies**. Everything visual/audible is procedural (DynamicTexture,
   NoiseProceduralTexture, MeshBuilder, custom shaders via ShaderMaterial, WebAudio
   synthesis). No network fetches at runtime.
4. **Babylon 9**: the installed `@babylonjs/core` is v9 — check
   `node_modules/@babylonjs/core/**/*.d.ts` for exact signatures when unsure, or use
   the context7 MCP tools. Do not guess APIs from memory of older versions.
5. **Verify before finishing**: `bunx tsc --noEmit` must show zero errors IN YOUR FILES
   (other agents work concurrently; ignore errors in directories you don't own).
   Write vitest unit tests (`*.test.ts`) for every piece of pure logic in your
   subsystem and make `bunx vitest run src/<your-dir>` pass. This project uses
   **bun** for everything (`bun install`, `bun run dev`, `bunx tsc`).
6. **Performance hygiene**: no per-frame allocations in hot paths (reuse Vector3/
   Matrix scratch objects), dispose everything you create in `dispose()`, unsubscribe
   every observer you add, respect `scene.getEngine().isDisposed` edge cases.
7. **Integration surface**: implement the interface from `src/core/types.ts` exactly.
   Your system's constructor signature must stay compatible with `src/core/Game.ts`.

## System topology

```
main.ts → Game (state machine, render loop)
  ├─ core: EventBus, Config, SettingsManager, SaveSystem, InputManager, math
  ├─ rendering  — lights, IBL, PBR material library, post-process stack, quality scaling
  ├─ physics    — Havok world, raycasts, body registry, character controller support
  ├─ player     — FPS controller (PhysicsCharacterController), camera feel, interaction
  ├─ portals    — portal gun, placement, RTT rendering, teleportation of player+objects
  ├─ puzzle     — buttons, cubes, doors, lasers, faith plates, funnels, bridges, goo…
  ├─ levels     — chamber data, chamber builder (panel rooms), level flow, elevator
  ├─ audio      — WebAudio graph, procedural SFX synth, generative music, spatialization
  └─ ui         — DOM overlay: menus, HUD, subtitles, settings, fades
```

Update order per frame (playing state): player → portals → puzzle → levels.
Every state: rendering → audio → ui. Physics steps with `scene.render()`.

## Cross-system rules

- **Events over calls** for anything one-to-many (`portal:placed`, `element:activated`,
  `player:died`…). Direct calls only through the interfaces in `core/types.ts`.
- **Portalable surfaces**: meshes that accept portals carry `metadata.portalable = true`.
  The chamber builder tags white panels portalable, dark panels not.
- **Teleportables**: physics bodies that may pass through portals register with the
  portal system (see `src/portals` after it lands). The player is handled specially.
- **IDs**: puzzle elements are addressed by their `id` from the chamber definition;
  links (`ElementLink`) wire activators → reactors with AND/OR logic per element.

## Coordinate conventions

- Meters, Y-up, left-handed (Babylon default). Chamber interiors are centered on the
  origin in X/Z; floor at y=0.
- Portal frames: `normal` points OUT of the wall into the room; `up` orients the ellipse.
- The portal pair transform is `sourceInverse · RotY(π) · targetWorld` (row-vector
  order!) and maps space in front of the source portal to the virtual space BEHIND the
  target portal. See `src/core/math.ts` and its tests — never reimplement this.

## Visual identity

Aperture Science: white modular wall panels (2m grid), dark gunmetal non-portalable
surfaces, orange/blue accent lighting, clean emissive strip lights, subtle grime in
corners, volumetric-feeling light shafts faked with billboards, faint dust motes.
UI: thin uppercase letter-spaced typography, cyan `#6ec1ff` accents on near-black.
