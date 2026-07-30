# rendering — RenderingSystem (src/rendering/**)

GOAL: the Aperture Science look at AAA quality — pristine white modular panels,
gunmetal dark surfaces, orange/blue accents, soft IBL, restrained bloom, filmic
tone mapping. Replace the stub in `src/rendering/RenderingSystem.ts`
(keep class name + constructor `new RenderingSystem()`).

## Implement IRenderingSystem (src/core/types.ts) exactly

- `materials: IMaterialLibrary` — shared PBR material instances. Consumers must
  never mutate them; cache and reuse. Throw if accessed before init (stub does).
- `applyQuality(level)`, `setMood(mood)`, `shake(intensity)`, `update(dt)`, `dispose()`.

## Material library (all procedural; PBR values plausible)

Generate albedo/normal/roughness via DynamicTexture (canvas 2D) and/or
NoiseProceduralTexture. Consistent texel density (~256px per 2m panel, 512 for
hero surfaces). Write a reusable height→normal helper (Sobel) as a pure
function and unit-test it.

- `wallPanel(true)`: off-white 2m panel tile — subtle seam border, per-panel
  tint jitter, micro-scratches, faint corner grime; roughness ~0.5, metallic 0.
- `wallPanel(false)`: dark gunmetal — brushed streaks, roughness ~0.45, metallic ~0.85.
- `floorPanel()`: darker scuffed panels, roughness ~0.4 with wear variation.
- `ceilingPanel()`: light-housing recess pattern (pairs with emissive fixtures).
- `trimMetal()`: brushed aluminum, metallic 1, roughness ~0.35.
- `darkMetal()`: near-black structural metal.
- `glass()`: transmissive PBR — subtle tint, low roughness, correct alpha handling.
- `emissive(color, intensity?)`: self-illuminated strips/indicators.
- `cubeShell()`: white plastic, subtle edge wear, Aperture-style circular logo
  drawn into the texture (canvas circles/lines — no font dependency).
- `buttonHousing()`: dark housing with accent ring.

## Lighting + environment

- Key directional light with shadows (map size from
  `CONFIG.rendering.shadowMapSize` per quality; 0 = shadows off), tuned
  bias/normalBias; only the key light casts.
- Hemispheric fill (sky/ground colors per mood).
- IBL fully procedural: build a small cube environment via RawCubeTexture
  (generated RGBA faces — dark floor, bright ceiling-strip gradient) assigned
  to `scene.environmentTexture` with modest `scene.environmentIntensity`.
  Verify the RawCubeTexture signature in the d.ts files first.
- `scene.clearColor` near-black blue.

## Post stack (DefaultRenderingPipeline or manual chain)

- MSAA samples per `CONFIG.rendering.msaaSamples`, FXAA on, bloom
  (threshold/weight from Config), imageProcessing: ACES tone mapping,
  exposure/contrast from Config, vignette (Config weight), film grain
  (procedural grain texture, Config intensity), subtle chromatic aberration.
- SSAO2 at high/ultra only (quality-scaled); skip gracefully if unsupported.

## Moods (setMood)

- `clean`: bright neutral. `damaged`: dimmer + warmer with a deterministic
  pseudo-random light-flicker driver (no per-frame allocation). `dark`:
  emergency low orange pools, most lights off. Smooth damped transitions
  (use `damp` from core/math.ts).

## Feel + ambience

- `shake(intensity)`: trauma-based decaying rotational noise applied to the
  active camera in `update()` — rendering.update runs AFTER player.update each
  frame (see Game.ts), so compose additively and decay; never fight the player
  controller. No allocation.
- Dust motes: one shared ParticleSystem, procedural soft-dot texture, slow
  drift, additive, budget scaled by quality.
- Fake volumetric light shafts: billboard planes with gradient alpha texture,
  additive, very subtle. Expose a helper on your concrete class so levels can
  request shafts at positions — note it in your report.

## Performance

- `freezeWorldMatrix` on static things you create; dispose ALL
  textures/materials/lights/pipelines in `dispose()`; `applyQuality` must not
  leak (recreate or adjust cleanly).

## Tests (src/rendering/*.test.ts)

Pure logic: quality-tier mapping, height→normal on known inputs, shake decay
curve, mood lerp targets, texture-size helpers.
