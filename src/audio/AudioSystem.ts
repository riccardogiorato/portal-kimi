/**
 * audio/AudioSystem.ts — Procedural WebAudio soundscape for PORTAL-KIMI.
 *
 * Implements IAudioSystem: spatialized one-shots/loops, synth toolkit,
 * generative music, gesture-unlock robustness. Zero sample files.
 */

import { Vector3 } from '@babylonjs/core';
import type { IAudioSystem, IGameContext, MusicState } from '../core/types';
import { MusicEngine, type MusicEngineConfig } from './music';
import { getLoopRecipe, getRecipe } from './recipes';
import { createPanner, LoopVoice, Voice } from './synth';

interface AudioSystemOptions {
  /** Factory injected for tests; defaults to global AudioContext. */
  audioContextFactory?: () => AudioContext | null;
}

interface LoopHandle {
  voice: LoopVoice;
  panner: PannerNode | null;
  disposeTimer: ReturnType<typeof setTimeout> | null;
}

interface VoiceHandle {
  voice: Voice;
  disposeTimer: ReturnType<typeof setTimeout> | null;
}

function defaultAudioContextFactory(): AudioContext | null {
  const AC = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    return new AC();
  } catch {
    return null;
  }
}

export class AudioSystem implements IAudioSystem {
  readonly name = 'audio';

  private readonly contextFactory: () => AudioContext | null;
  private ctx!: IGameContext;
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicEngine: MusicEngine | null = null;

  private readonly loops = new Map<string, LoopHandle>();
  private readonly pendingLoops: { loopId: string; soundId: string; position?: Vector3 }[] = [];
  private readonly activeVoices = new Set<VoiceHandle>();
  private readonly unknownIds = new Set<string>();
  private nextLoopId = 1;
  private disposed = false;

  private readonly unsubs: (() => void)[] = [];
  private readonly gestureListeners: { target: EventTarget; type: string; fn: EventListener }[] = [];

  private readonly FORWARD = new Vector3(0, 0, 1);
  private readonly UP = new Vector3(0, 1, 0);
  private readonly scratchForward = new Vector3();
  private readonly scratchUp = new Vector3();

  constructor(options: AudioSystemOptions = {}) {
    this.contextFactory = options.audioContextFactory ?? defaultAudioContextFactory;
  }

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    if (this.disposed) return;

    const ok = this.buildGraph();
    if (!ok) {
      // WebAudio is unavailable. All calls remain no-ops safely.
      return;
    }

    this.wireSettings(ctx);
    this.wireSubtitles(ctx);
    this.wireGestureUnlock();
    this.applySettings();
  }

  update(_dtSeconds: number): void {
    if (!this.audioCtx || this.audioCtx.state !== 'running') return;

    const camera = this.ctx.systems.player?.camera;
    if (!camera) return;

    const listener = this.audioCtx.listener;
    const t = this.audioCtx.currentTime;
    const pos = camera.position;
    listener.positionX.setValueAtTime(pos.x, t);
    listener.positionY.setValueAtTime(pos.y, t);
    listener.positionZ.setValueAtTime(pos.z, t);

    camera.getDirectionToRef(this.FORWARD, this.scratchForward);
    camera.getDirectionToRef(this.UP, this.scratchUp);
    listener.forwardX.setValueAtTime(this.scratchForward.x, t);
    listener.forwardY.setValueAtTime(this.scratchForward.y, t);
    listener.forwardZ.setValueAtTime(this.scratchForward.z, t);
    listener.upX.setValueAtTime(this.scratchUp.x, t);
    listener.upY.setValueAtTime(this.scratchUp.y, t);
    listener.upZ.setValueAtTime(this.scratchUp.z, t);

    this.musicEngine?.update(_dtSeconds);
  }

  play(soundId: string, options?: { volume?: number; pitch?: number }): void {
    this.playInternal(soundId, undefined, options ?? {});
  }

  playAt(soundId: string, position: Vector3, options?: { volume?: number; pitch?: number }): void {
    this.playInternal(soundId, position, options ?? {});
  }

  startLoop(soundId: string, position?: Vector3): string {
    const loopId = `loop-${this.nextLoopId++}`;

    if (!this.audioCtx || this.audioCtx.state !== 'running') {
      // Remember request so it begins as soon as the user gesture unlocks audio.
      const req = position ? { loopId, soundId, position } : { loopId, soundId };
      this.pendingLoops.push(req);
      return loopId;
    }

    this.startLoopNow(loopId, soundId, position);
    return loopId;
  }

  stopLoop(loopId: string): void {
    const idx = this.pendingLoops.findIndex((p) => p.loopId === loopId);
    if (idx >= 0) this.pendingLoops.splice(idx, 1);

    const handle = this.loops.get(loopId);
    if (!handle) return;

    handle.voice.fadeOut(0.05);
    const stopAt = this.audioCtx ? this.audioCtx.currentTime + 0.15 : 0;
    handle.voice.stop(stopAt);

    const timer = setTimeout(() => {
      handle.voice.dispose();
      handle.panner?.disconnect();
      this.loops.delete(loopId);
    }, 200);
    handle.disposeTimer = timer;
  }

  setMusicState(state: MusicState): void {
    this.musicEngine?.setState(state);
  }

  applySettings(): void {
    const settings = this.ctx?.settings?.settings;
    if (!settings) return;
    const config = this.ctx.config.audio;

    const master = settings.masterVolume * config.masterBusGain;
    if (this.masterGain) {
      this.masterGain.gain.cancelScheduledValues(this.audioCtx!.currentTime);
      this.masterGain.gain.setTargetAtTime(master, this.audioCtx!.currentTime, 0.05);
    }
    if (this.sfxBus) {
      this.sfxBus.gain.cancelScheduledValues(this.audioCtx!.currentTime);
      this.sfxBus.gain.setTargetAtTime(settings.sfxVolume, this.audioCtx!.currentTime, 0.05);
    }
    this.musicEngine?.setVolume(settings.musicVolume, settings.masterVolume);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const unsub of this.unsubs) unsub();
    for (const { target, type, fn } of this.gestureListeners) {
      target.removeEventListener(type, fn);
    }

    for (const handle of this.activeVoices) {
      if (handle.disposeTimer) clearTimeout(handle.disposeTimer);
      handle.voice.dispose();
    }
    this.activeVoices.clear();

    for (const id of [...this.loops.keys()]) {
      const handle = this.loops.get(id);
      if (!handle) continue;
      if (handle.disposeTimer) clearTimeout(handle.disposeTimer);
      handle.voice.dispose();
      handle.panner?.disconnect();
      this.loops.delete(id);
    }
    this.pendingLoops.splice(0, this.pendingLoops.length);

    this.musicEngine?.dispose();
    this.musicBus?.disconnect();
    this.sfxBus?.disconnect();
    this.compressor?.disconnect();
    this.masterGain?.disconnect();

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try {
        void this.audioCtx.close();
      } catch {
        // already closed / unstarted
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Graph construction
  // ---------------------------------------------------------------------------

  private buildGraph(): boolean {
    const actx = this.createContextSafe();
    if (!actx) return false;
    this.audioCtx = actx;

    const { config, settings } = this.ctx;

    this.masterGain = actx.createGain();
    this.masterGain.gain.value = settings.settings.masterVolume * config.audio.masterBusGain;

    this.compressor = actx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 6;
    this.compressor.ratio.value = 8;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.1;

    this.sfxBus = actx.createGain();
    this.sfxBus.gain.value = settings.settings.sfxVolume;

    this.musicBus = actx.createGain();
    this.musicBus.gain.value = 1;

    this.masterGain.connect(this.compressor);
    this.compressor.connect(actx.destination);
    this.sfxBus.connect(this.masterGain);
    this.musicBus.connect(this.masterGain);

    const musicCfg: MusicEngineConfig = {
      busGain: this.musicBus,
      sampleRate: actx.sampleRate,
      masterVolume: settings.settings.masterVolume,
      musicVolume: settings.settings.musicVolume,
    };
    this.musicEngine = new MusicEngine(actx, musicCfg);
    this.musicEngine.setVolume(settings.settings.musicVolume, settings.settings.masterVolume);

    return true;
  }

  private createContextSafe(): AudioContext | null {
    try {
      return this.contextFactory();
    } catch (error) {
      console.warn('[AudioSystem] AudioContext creation failed:', error);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Playback internals
  // ---------------------------------------------------------------------------

  private playInternal(
    soundId: string,
    position: Vector3 | undefined,
    options: { volume?: number; pitch?: number },
  ): void {
    if (!this.audioCtx || this.audioCtx.state !== 'running') return;

    const recipe = getRecipe(soundId);
    if (!recipe) {
      if (!this.unknownIds.has(soundId)) {
        console.warn(`[AudioSystem] unknown sound id: ${soundId}`);
        this.unknownIds.add(soundId);
      }
      return;
    }

    const out = position ? this.buildPanner(position) : this.sfxBus!;
    const now = this.audioCtx.currentTime;
    const voice = recipe({ ctx: this.audioCtx, out, now }, options);
    voice.start(now);
    this.scheduleVoiceCleanup(voice);
  }

  private scheduleVoiceCleanup(voice: Voice): void {
    const handle: VoiceHandle = { voice, disposeTimer: null };
    this.activeVoices.add(handle);

    const durationMs = Math.max(50, voice.duration * 1000 + 50);
    handle.disposeTimer = setTimeout(() => {
      handle.voice.dispose();
      this.activeVoices.delete(handle);
    }, durationMs);
  }

  private startLoopNow(loopId: string, soundId: string, position?: Vector3): void {
    const recipe = getLoopRecipe(soundId);
    if (!recipe) {
      this.warnUnknownLoopId(soundId);
      return;
    }

    const out = position ? this.buildPanner(position) : this.sfxBus!;
    const now = this.audioCtx!.currentTime;
    const voice = recipe({ ctx: this.audioCtx!, out, now });
    voice.start(now);
    this.loops.set(loopId, { voice, panner: position ? out as PannerNode : null, disposeTimer: null });
  }

  private buildPanner(position: Vector3): PannerNode {
    const cfg = this.ctx.config.audio;
    return createPanner(this.audioCtx!, cfg.refDistance, cfg.maxDistance, cfg.rolloff, position);
  }

  private warnUnknownLoopId(soundId: string): void {
    if (!this.unknownIds.has(soundId)) {
      console.warn(`[AudioSystem] unknown loop id: ${soundId}`);
      this.unknownIds.add(soundId);
    }
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------

  private wireSettings(ctx: IGameContext): void {
    this.unsubs.push(
      ctx.events.on('settings:changed', () => this.applySettings()),
    );
  }

  private wireSubtitles(ctx: IGameContext): void {
    this.unsubs.push(
      ctx.events.on('ui:subtitle', () => {
        // Subtle comms chirp before every subtitle line.
        this.playInternal('ui.hover', undefined, { volume: 0.22 });
      }),
    );
  }

  private wireGestureUnlock(): void {
    const onGesture = (): void => {
      if (!this.audioCtx || this.audioCtx.state !== 'suspended') return;
      void this.audioCtx.resume().then(() => this.flushPendingLoops());
    };

    const targets: { target: EventTarget; type: string }[] = [
      { target: this.ctx.canvas, type: 'mousedown' },
    ];
    if (typeof document !== 'undefined') {
      targets.push({ target: document, type: 'pointerlockchange' });
    }
    if (typeof window !== 'undefined') {
      targets.push({ target: window, type: 'keydown' });
    }

    for (const { target, type } of targets) {
      target.addEventListener(type, onGesture, { once: true });
      this.gestureListeners.push({ target, type, fn: onGesture });
    }
  }

  private flushPendingLoops(): void {
    while (this.pendingLoops.length) {
      const req = this.pendingLoops.shift()!;
      this.startLoopNow(req.loopId, req.soundId, req.position);
    }
  }
}
