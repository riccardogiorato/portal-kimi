# Agent Brief — PORTAL-KIMI subsystem build

You are one of 8 subsystem engineers building PORTAL-KIMI: a Portal 2-grade
first-person puzzle game. Babylon.js 9 + TypeScript (strict) + Vite 8 + Havok
physics (WASM). Zero external assets — every texture, mesh, and sound is
generated procedurally at runtime.
Project root: /Users/riccardogiorato/Desktop/github/portal-kimi

## Read first (in this order)

1. `docs/ARCHITECTURE.md` — topology + ground rules
2. `docs/RUBRIC.md` — the AAA review standard you must pass
3. `docs/SOUND_IDS.md` — sound ids + mesh metadata conventions
4. `src/core/types.ts` — contracts; implement your interface EXACTLY
5. `src/core/Config.ts` — ALL tuning numbers come from here
6. `src/core/math.ts`, `src/core/EventBus.ts`, `src/core/InputManager.ts`, `src/core/soundIds.ts`
7. `src/core/Game.ts` — how your system is constructed, initialized, updated
8. Your spec file `docs/agents/<your-subsystem>.md` and your stub in `src/<your-subsystem>/`

## Hard rules (violation = automatic reject at review)

- Own ONLY `src/<your-dir>/**`. Never edit `src/core/**`, `src/main.ts`,
  `index.html`, `package.json`, `docs/**`, `tools/**`, or another subsystem's
  directory. If a contract seems insufficient, expose the capability on your
  concrete class and note it in your report — do not patch shared files.
- No new dependencies. No runtime network fetches. Everything procedural
  (DynamicTexture, NoiseProceduralTexture, MeshBuilder, ShaderMaterial, WebAudio).
- Babylon 9 is installed — verify API signatures against
  `node_modules/@babylonjs/core/**/*.d.ts` when unsure. Do not guess APIs from
  memory of older versions.
- Constructor signature must stay compatible with `src/core/Game.ts`.
- 7 other agents work CONCURRENTLY in the same repo. `bunx tsc --noEmit` may
  show errors in files you don't own — ignore those; YOUR files must be
  error-free. NEVER run `bun run build` / `bun run dev` / `vite` (they collide
  across agents). Verify with `bunx tsc --noEmit` and `bunx vitest run src/<your-dir>`.
- No per-frame allocations in hot paths (reuse scratch Vector3/Matrix/Quaternion).
  Dispose everything you create; unsubscribe every observer; no orphaned
  setInterval/setTimeout.
- Write vitest unit tests (`*.test.ts`) for every piece of pure logic;
  `bunx vitest run src/<your-dir>` must pass.
- All gameplay-tuning numbers come from `src/core/Config.ts` — no scattered
  magic numbers. Small internal/visual constants are fine if named and justified.

## Report format (your final message — it is data, not prose for a human)

1. Status: complete | partial | blocked
2. Files created/modified (paths)
3. Public API notes (anything beyond the interface others may rely on)
4. Integration concerns (things you needed but couldn't change; assumptions
   you made about other subsystems)
5. Verification: exact commands run + results
