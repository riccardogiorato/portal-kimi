# ui — UISystem (src/ui/**)

GOAL: an Aperture-grade interface — thin uppercase letter-spaced typography,
cyan `#6ec1ff` accents on near-black, buttery transitions. Pure DOM overlay
(no Babylon GUI). Replace the stub in `src/ui/UISystem.ts` (keep class name +
`new UISystem()`).

## Implement IUISystem exactly

`showMainMenu()` / `showPauseMenu()` / `showHUD()` / `hideAll()` /
`setPortalIndicators(blue, orange)` / `showSubtitle(text, dur?, speaker?)` /
`showHint(text)` / `showLoading(definition)` / `fadeToBlack(s)` /
`fadeFromBlack(s)` (promises) / `update(dt)` / `dispose()`.

## Structure

- Inject one `<style>` + build DOM under a root you append to `document.body`
  (index.html only has the canvas + boot screen — you own everything else).
  HUD root: `pointer-events: none`. Menu root: `pointer-events: auto` only
  while a menu is visible. Never block canvas clicks when hidden.
- Drive everything off events (src/core/types.ts GameEventMap):
  `game:stateChanged`, `level:loading/loaded/completed`, `player:interactPrompt`,
  `player:died`, `ui:subtitle`, `ui:hint`, `portal:placed/cleared`,
  `settings:changed`. Emit `game:resumeRequested`, `game:quitToMenu`,
  `level:loadRequested`, `level:restartRequested` from menu actions.
  Unsubscribe everything in `dispose()`.

## Screens

- MAIN MENU: game title, BEGIN TESTING / CONTINUE (save-aware via
  `levels.getLevelList()`), CHAMBER SELECT (locked entries disabled, completed
  checkmarked), SETTINGS, QUIT. Subtle animated background flourish (CSS only).
- PAUSE: RESUME / RESTART CHAMBER / SETTINGS / QUIT TO MENU.
- SETTINGS: master/music/sfx volume sliders, mouse sensitivity, invert Y
  toggle, FOV slider (60–120), quality select (low/medium/high/ultra),
  subtitles toggle — all via `ctx.settings.update({...})` (it persists +
  emits `settings:changed`; audio/rendering/player react live).
- LOADING (`showLoading(def)` + `level:loading`): chamber number + name +
  tagline on black, Aperture-style; shown between chambers.
- DEATH: brief red-tinged flash + "TEST SUBJECT TERMINATED"-style beat
  (Game handles the actual respawn fade).
- CHAMBER COMPLETE: minimal completion beat (Game auto-advances).

## HUD

- Dynamic crosshair: center dot + 4 ticks; expands slightly when
  `player:interactPrompt` is non-null; shows the prompt text ("[E] Pick up").
- Portal indicators: two dots (blue/orange) lit per `setPortalIndicators` —
  also update on `portal:placed`/`portal:cleared` events.
- Subtitles: bottom-center, speaker label when given, queued (don't overlap),
  respect `settings.subtitles`.
- Hints: `ui:hint` → toast, auto-dismiss.
- All text: uppercase, letter-spaced, thin weights; cyan accents; consistent
  8px spacing scale; transitions 150–250ms ease.

## Fades

`fadeToBlack`/`fadeFromBlack`: full-screen black overlay, resolve the promise
when the transition completes; robust to overlapping calls (latest wins).

## Tests (src/ui/*.test.ts)

Pure logic: subtitle queue, menu navigation state, settings binding
(sanitize/clamp passthrough), time formatting. Use jsdom-free fakes where
possible; keep DOM code thin over testable cores.
