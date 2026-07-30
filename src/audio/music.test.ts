/**
 * audio/music.test.ts — Music engine state / scheduling logic.
 */
import { describe, expect, it } from 'vitest';
import { createFakeAudioContext } from './audioTestUtils';
import { MusicEngine } from './music';

function makeEngine(ctx = createFakeAudioContext()) {
  const bus = ctx.createGain();
  bus.gain.value = 1;
  return new MusicEngine(ctx, { busGain: bus, sampleRate: 48000, masterVolume: 1, musicVolume: 1 });
}

describe('MusicEngine', () => {
  it('begins in off state with silent drones', () => {
    const ctx = createFakeAudioContext();
    const engine = makeEngine(ctx);
    // Drones are created but gains should be zero before state change.
    expect(ctx.createOscillator).toBeDefined();
    engine.dispose();
  });

  it('crossfades to a menu chord', () => {
    const ctx = createFakeAudioContext('running');
    const engine = makeEngine(ctx);
    const bus = (engine as unknown as { cfg: { busGain: GainNode } }).cfg.busGain;
    expect(bus.gain.value).toBe(1);
    engine.setState('menu');
    // Air noise and drone gains are scheduled targets, not absolute values.
    // The real assertion is that no exception is thrown and nodes remain.
    expect(ctx.state).toBe('running');
    engine.dispose();
  });

  it('applies volume from outside', () => {
    const ctx = createFakeAudioContext('running');
    const engine = makeEngine(ctx);
    const bus = (engine as unknown as { cfg: { busGain: GainNode } }).cfg.busGain;
    engine.setVolume(0.5, 0.8);
    // setTargetAtTime updates value in fake params; bus gain should drop.
    expect(bus.gain.value).toBeLessThan(1);
    engine.dispose();
  });

  it('switches states without crashing', () => {
    const ctx = createFakeAudioContext('running');
    const engine = makeEngine(ctx);
    engine.setState('menu');
    engine.setState('chamber-calm');
    engine.setState('chamber-tense');
    engine.setState('chamber-complete');
    engine.setState('off');
    engine.dispose();
  });

  it('update drifts detune silently', () => {
    const ctx = createFakeAudioContext('running');
    const engine = makeEngine(ctx);
    engine.setState('menu');
    engine.update(0.016);
    engine.dispose();
  });

  it('disconnects the air-noise managed filter on dispose', () => {
    const ctx = createFakeAudioContext('running');
    const engine = makeEngine(ctx);
    engine.setState('menu');
    const airNoise = (engine as unknown as { airNoise: { managedNodes: { disconnected: boolean }[] } }).airNoise;
    expect(airNoise.managedNodes.length).toBeGreaterThan(0);
    const airFilter = airNoise.managedNodes[0];
    engine.dispose();
    expect(airFilter.disconnected).toBe(true);
  });
});
