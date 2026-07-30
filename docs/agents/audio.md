# audio — AudioSystem (src/audio/**)

GOAL: a fully procedural WebAudio soundscape — every SFX synthesized, generative
music per game state, spatialized one-shots and loops. Zero audio files.
Replace the stub in `src/audio/AudioSystem.ts` (keep class name +
`new AudioSystem()`).

## Implement IAudioSystem exactly

`play(id, {volume, pitch}?)` / `playAt(id, position, {volume, pitch}?)` /
`startLoop(id, position?) → loopId` / `stopLoop(loopId)` /
`setMusicState(state)` / `applySettings()` / `update(dt)` / `dispose()`.

## Graph + robustness

- AudioContext → master gain → compressor → destination; separate music/sfx
  buses; volumes from `ctx.settings` (`applySettings` re-reads; subscribe
  `settings:changed`).
- The context starts SUSPENDED until a user gesture: resume on first
  pointerlock/click/keydown (listen once); until then all calls no-op safely.
  Never throw on unknown ids — warn once, no-op (docs/SOUND_IDS.md).
- `dispose()` closes the context and stops everything.

## SFX synthesis (every id in src/core/soundIds.ts — docs/SOUND_IDS.md)

Build a small synth toolkit (osc + noise buffer + filters + envelopes) and
design each sound to be unmistakable, Portal-flavored:

- portal.fire.blue/orange: electric zap-chirp (pitch per color); portal.open:
  airy shimmer-whoosh; portal.close: reverse collapse; portal.fizzle: sad
  static sputter; portal.enter/exit: submersion sweep down/up.
- button.press/release: heavy clunk + spring; door.open/close: servo whoosh +
  seal thunk; cube.pickup/drop/bounce: plastic thunk (velocity-scaled);
  cube.fizzle: dissolve crackle; dispenser.drop: pneumatic ka-chunk.
- laser.hum (loop): dangerous coil whine; laser.kill: searing zap;
  funnel.loop: smooth whooshing current; bridge.loop: hard-light shimmer;
  faithplate.launch: springy pneumatic BOING-thunk; platform.move: servo loop.
- goo.death: toxic sizzle-bubble; player.step: soft sole taps (pitch-varied,
  rate from event cadence); player.jump: cloth whoosh; player.land: weighty
  thump scaled by impact; elevator.loop: smooth motor + rail hum;
  chamber.complete: bright two-tone confirmation sting; ambient.hum (loop):
  room tone — low HVAC + faint fluorescent buzz.
- ui.click/ui.hover: minimal, precise blips.
- `ui:subtitle` events → subtle comms chirp (announcer voice blip) before each
  line — quiet, tasteful.

## Spatialization

- `playAt`/`startLoop(position)`: PannerNode (equalpower is fine) +
  distance model from CONFIG.audio (refDistance, maxDistance, rolloff).
  Update loop panner positions if their source moves? (Loops are static per
  element — static is fine.) Listener = player camera: update position +
  orientation every `update(dt)` (no allocation).

## Generative music (setMusicState)

Seeded, non-repetitive, tasteful: `menu` (calm detuned pads, slow filter
LFO), `chamber-calm` (sparse ambient pulses + air), `chamber-tense` (added
low pulse + minor movement), `chamber-complete` (short resolve sting then
calm), `off`. Crossfade between states (2–4s); never harsh; music bus volume
from settings. Keep voices few and reused; no per-beat allocation storms.

## Tests (src/audio/*.test.ts)

Pure logic: envelope curves, music sequencer scheduling (given a fake clock),
volume/pan math, id registry coverage (every SOUND id has a recipe).
WebAudio itself: guard with fakes — do not require a real AudioContext in
tests.
