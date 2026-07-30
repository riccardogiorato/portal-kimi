# portals — PortalSystem (src/portals/**)

GOAL: THE signature mechanic — pixel-perfect portal placement, seamless
see-through portals with recursion, momentum-conserving teleportation. This is
the hardest subsystem; Portal 2 is the reference. Replace the stub in
`src/portals/PortalSystem.ts` (keep class name + `new PortalSystem()`).

## Implement IPortalSystem exactly

`fire(color)`, `getPortal(color)`, `isLinked`, `clearAll()`,
`isPortalable(mesh)`, `update(dt)`, `dispose()`.

Use `core/math.ts` for ALL portal math (portalFrameToMatrix,
portalPairTransform, transformDirectionThroughPortal, crossedPortalThisFrame,
makeObliqueProjection, signedDistanceToPortalPlane, isWithinPortalBounds) —
never reimplement it.

## Firing + placement

- `fire(color)`: cooldown `CONFIG.portals.fireCooldownSeconds`; raycast from
  the player camera (`physics.raycast`, `maxFireDistance`).
- Portal shots TRAVEL THROUGH open portals: if the ray hits the linked pair's
  opening surface, transform origin+direction through `portalPairTransform`
  and continue the raycast (max 2 hops).
- Validate the hit: `metadata.portalable === true`; the panel run is big
  enough (`metadata.panelSize` ≥ `minSurfaceWidth`/`minSurfaceHeight`); hit
  normal within ~15° of the surface normal (reject grazing); not glass
  (`metadata.glass`). On failure emit `portal:placementFailed` + play
  `portal.fizzle` at the hit point.
- On success: place with an opening animation, emit `portal:fired` +
  `portal:placed`; replacing an existing same-color portal emits
  `portal:cleared` first (+ `portal.close` sound). Sounds: `portal.fire.blue`/
  `portal.fire.orange` on fire, `portal.open` on place.
- Frame: `normal` points OUT of the wall; `up` = world-up projected (floor/
  ceiling portals: math.ts fallback handles it); inset `surfaceOffset`.

## Portal visuals (procedural, AAA)

- Elliptical ring frame (CONFIG width/height) with emissive edge glow in the
  portal's color (CONFIG.portals.colors), subtle animated energy crawl.
- Interior surface: ShaderMaterial sampling the LINKED portal's RTT with
  animated swirl distortion + chromatic edge fringe; when unlinked, show an
  opaque swirling color disc.
- Layer masks (docs/SOUND_IDS.md): default geometry `0x0FFFFFFF`; blue surface
  `0x20000000`; orange `0x40000000`. Main camera sees all; each portal's RTT
  camera excludes its OWN surface layer.
- Opening: scale-from-zero with overshoot, particle burst, brief point-light
  flash. Closing: quick collapse. All pooled/reused — no leak per shot.
- PORTAL GUN VIEWMODEL: procedural white-pronged device attached to the player
  camera (bottom-right), idle sway + walk bob, recoil kick on fire, glowing
  tip tinted by the last fired color. This is a huge first-person win.

## See-through rendering (RTT)

- One RenderTargetTexture per portal, size from `CONFIG.portals.rttSize` by
  quality. Virtual camera pose = main camera transformed by
  `portalPairTransform(source: thisPortal, target: linkedPortal)` — the view
  through A is rendered from behind B.
- OBLIQUE NEAR-PLANE clipping is mandatory (no geometry leaking from behind
  the exit wall): use `makeObliqueProjection` with the exit portal's plane
  transformed into the virtual camera's view space. Verify the exact Babylon 9
  mechanism for overriding a camera's projection per frame in the d.ts
  (e.g. freezing/overriding getProjectionMatrix on the RTT camera). Fallback:
  `scene.clipPlane` scoped to the RTT render via onBeforeRender/onAfterRender.
- Recursion per `CONFIG.portals.recursionPasses`: render the linked portal's
  RTT first (containing this portal's view) for depth-2 portal-in-portal.
  Never feedback-loop: own surface layer excluded, fixed pass order.
- RTT refresh: every frame at high/ultra; half-rate at medium/low is fine.

## Teleportation

- Track the player's previous position each frame; when linked and
  `crossedPortalThisFrame` (with CONFIG width/height half-extents) →
  `player.teleportThroughPortal(pairTransform, linkedNormal)`; emit
  `player:teleported`; play `portal.enter`/`portal.exit` at the right ends.
- Physics objects: scan `physics.getTeleportables()` each frame (skip bodies
  asleep longer than `CONFIG.physics.sleepTeleportThresholdSeconds`); same
  crossing test on body positions; on cross → `physics.teleportBody` +
  `physics.setLinearVelocity(transformedVelocity)`; emit `object:teleported`.
- Per-entity cooldown `teleportCooldownSeconds` to stop oscillation; entities
  straddling a closing portal get nudged out along its normal; a carried
  object mid-portal when the link breaks → `object:fizzled
  { reason: 'portal-closed' }`.
- `clearAll()`: close both with animation + sound.

## Performance

- Reuse ALL scratch objects (this runs every frame for every entity).
- Consider `rtt.renderList` culling or `refreshRate` tuning; freeze world
  matrices on static geometry you create.

## Tests (src/portals/*.test.ts)

Pure logic: placement validation (panel fit, grazing angle, glass), ray-hop
transform through portals, cooldown tracker, per-entity crossing bookkeeping.
