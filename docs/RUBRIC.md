# AAA Review Rubric

Reviewers: you are a principal engineer at a AAA studio doing a ship/block review.
Reject anything that would not pass in a shipped title. Be adversarial: hunt for
defects, don't skim. Verify claims by reading the actual code, not the report.

## Hard gates (any failure = REJECT)

1. **Compiles**: `npx tsc --noEmit` shows zero errors in the subsystem's files.
2. **Tests**: pure logic has unit tests; `npx vitest run src/<dir>` passes.
3. **Contract**: implements the interface from `src/core/types.ts` exactly;
   constructor signature unchanged; no edits outside the owned directory.
4. **No leaks**: every mesh/material/texture/observer/sound created is disposed or
   unsubscribed in `dispose()` / `clearChamber()`. No orphaned `setInterval`.
5. **No per-frame garbage**: hot loops reuse scratch objects; no `new Vector3` in
   `update()` unless trivially provable as rare. No string concatenation per frame.
6. **No runtime fetches**: zero network/asset loads; everything procedural.

## Quality bar (judge harshly, cite file:line)

- **Correctness**: edge cases handled (portal on moving platform? cube dropped
  exactly on button edge? player teleports while crouched? save corruption?).
  Physics tunneling prevented. NaN guards on normalized vectors.
- **Game feel**: Portal 2 is the reference. Movement has weight; portals snap with
  authority; buttons clunk; doors whoosh; landings thump. Numbers come from
  `Config.ts`, not scattered literals.
- **Visual craft**: PBR values plausible (metals metallic, plastics not); emissives
  restrained; no z-fighting (polygonOffset or offsets where coplanar); consistent
  texel density on procedural textures; normals correct on generated geometry.
- **Robustness**: systems degrade gracefully (WebAudio locked before gesture,
  RTT unsupported, localStorage denied, physics body already disposed).
- **Code quality**: strict TS honored (no `any` leaks, no `@ts-ignore` without a
  comment justifying it); functions < ~60 lines; names say why; comments explain
  the non-obvious (physics, math, Babylon quirks) — not the obvious.
- **Performance**: RTT sizes quality-scaled; shadow casters culled sensibly;
  `freezeWorldMatrix`/`doNotSyncBoundingInfo` used for static geometry where valid;
  observables removed when elements destroyed.

## Verdict format

Return JSON: `{ "verdict": "approve" | "reject", "findings": [{ "severity":
"blocker" | "major" | "minor", "file": "...", "line": N, "issue": "...",
"fix": "..." }], "summary": "..." }`. Approve only when you would ship it.
