/**
 * audio/AudioSystem.test.ts — IAudioSystem contract and integration tests.
 */
import type { UniversalCamera } from '@babylonjs/core';
import { Vector3 } from '@babylonjs/core';
import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../core/Config';
import { EventBus } from '../core/EventBus';
import { DEFAULT_SETTINGS } from '../core/SettingsManager';
import { SOUND } from '../core/soundIds';
import type { IGameContext, IPlayerSystem } from '../core/types';
import { AudioSystem } from './AudioSystem';
import { createFakeAudioContext } from './audioTestUtils';

function makeCamera(): UniversalCamera {
  const position = new Vector3(1, 2, 3);
  return {
    position,
    getDirectionToRef(local: Vector3, result: Vector3) {
      result.copyFrom(local);
    },
  } as unknown as UniversalCamera;
}

function makeContext(): IGameContext {
  const events = new EventBus();
  const settings = {
    get settings() {
      return { ...DEFAULT_SETTINGS };
    },
    update: () => {},
    persist: () => {},
    load: () => ({ ...DEFAULT_SETTINGS }),
  } as unknown as IGameContext['settings'];

  const player = {
    camera: makeCamera(),
    position: new Vector3(0, 0, 0),
    velocity: new Vector3(0, 0, 0),
    isGrounded: true,
    teleportThroughPortal: () => {},
    placeAt: () => {},
    setActive: () => {},
    launch: () => {},
    addExternalVelocity: () => {},
    init: () => {},
    update: () => {},
    dispose: () => {},
    name: 'player',
  } as unknown as IPlayerSystem;

  return {
    engine: {} as unknown as IGameContext['engine'],
    scene: {} as unknown as IGameContext['scene'],
    canvas: { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLCanvasElement,
    events,
    config: CONFIG,
    settings,
    systems: {
      player,
      physics: {} as unknown as IGameContext['systems']['physics'],
      portals: {} as unknown as IGameContext['systems']['portals'],
      puzzle: {} as unknown as IGameContext['systems']['puzzle'],
      rendering: {} as unknown as IGameContext['systems']['rendering'],
      audio: {} as unknown as IGameContext['systems']['audio'],
      ui: {} as unknown as IGameContext['systems']['ui'],
      levels: {} as unknown as IGameContext['systems']['levels'],
    },
  } as IGameContext;
}

describe('AudioSystem', () => {
  it('initializes and disposes without a real AudioContext', () => {
    const ctx = makeContext();
    const audio = new AudioSystem({ audioContextFactory: () => null });
    audio.init(ctx);
    expect(audio.name).toBe('audio');
    audio.dispose();
  });

  it('subscribes to settings changes and applies them', () => {
    const fakeCtx = createFakeAudioContext('running');
    const ctx = makeContext();
    const audio = new AudioSystem({ audioContextFactory: () => fakeCtx });
    audio.init(ctx);
    audio.applySettings();
    audio.dispose();
  });

  it('no-ops before the audio context is running', () => {
    const fakeCtx = createFakeAudioContext('suspended');
    const ctx = makeContext();
    const audio = new AudioSystem({ audioContextFactory: () => fakeCtx });
    audio.init(ctx);
    audio.play(SOUND.uiClick);
    audio.playAt(SOUND.uiHover, new Vector3(1, 1, 1));
    const id = audio.startLoop(SOUND.laserHum);
    expect(id).toMatch(/^loop-/);
    audio.stopLoop(id);
    audio.dispose();
  });

  it('plays one-shots after the context resumes', async () => {
    const fakeCtx = createFakeAudioContext('suspended');
    const ctx = makeContext();
    const audio = new AudioSystem({ audioContextFactory: () => fakeCtx });
    audio.init(ctx);
    await fakeCtx.resume();
    audio.play(SOUND.buttonPress);
    audio.playAt(SOUND.cubeDrop, new Vector3(2, 0, 2));
    audio.update(0.016);
    audio.dispose();
  });

  it('starts and stops positional loops after resume', async () => {
    const fakeCtx = createFakeAudioContext('suspended');
    const ctx = makeContext();
    const audio = new AudioSystem({ audioContextFactory: () => fakeCtx });
    audio.init(ctx);
    await fakeCtx.resume();
    const id = audio.startLoop(SOUND.funnelLoop, new Vector3(0, 0, 0));
    expect(id).toMatch(/^loop-/);
    audio.stopLoop(id);
    audio.dispose();
  });

  it('queues a loop started before gesture and flushes it on resume', async () => {
    const fakeCtx = createFakeAudioContext('suspended');
    const ctx = makeContext();
    const audio = new AudioSystem({ audioContextFactory: () => fakeCtx });
    audio.init(ctx);
    const id = audio.startLoop(SOUND.ambientHum);
    expect(id).toMatch(/^loop-/);
    await fakeCtx.resume();
    audio.update(0.016);
    audio.stopLoop(id);
    audio.dispose();
  });

  it('warns once for unknown one-shot ids and resumes no-op', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeCtx = createFakeAudioContext('running');
    const ctx = makeContext();
    const audio = new AudioSystem({ audioContextFactory: () => fakeCtx });
    audio.init(ctx);
    audio.play('not-a-sound');
    audio.play('not-a-sound');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    audio.dispose();
  });

  it('sets music state and updates without crashing', () => {
    const fakeCtx = createFakeAudioContext('running');
    const ctx = makeContext();
    const audio = new AudioSystem({ audioContextFactory: () => fakeCtx });
    audio.init(ctx);
    audio.setMusicState('menu');
    audio.setMusicState('chamber-tense');
    audio.setMusicState('chamber-complete');
    audio.update(0.016);
    audio.setMusicState('off');
    audio.dispose();
  });
});
