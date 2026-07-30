/**
 * audio/music.ts — Generative music engine.
 *
 * Seeded, non-repetitive pads/drones. Keeps a small, reused voice set;
 * state changes crossfade over a few seconds. No per-beat allocation storms.
 */

import type { MusicState } from '../core/types';
import { createNoiseBuffer, LoopVoice } from './synth';

export interface MusicEngineConfig {
  busGain: GainNode;
  sampleRate: number;
  masterVolume: number;
  musicVolume: number;
}

/** Xorshift-based RNG for deterministic but varied phrases. */
class Prng {
  private x: number;
  constructor(seed: number) {
    this.x = seed === 0 ? 123456789 : seed >>> 0;
  }

  next(): number {
    this.x ^= this.x << 13;
    this.x ^= this.x >>> 17;
    this.x ^= this.x << 5;
    return (this.x >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

interface DroneVoice {
  readonly osc: OscillatorNode;
  readonly gain: GainNode;
  readonly baseFreq: number;
}

export class MusicEngine {
  private readonly ctx: BaseAudioContext;
  private readonly cfg: MusicEngineConfig;
  private rng: Prng;
  private state: MusicState = 'off';
  private readonly drones: DroneVoice[] = [];
  private readonly airNoise: LoopVoice;
  private readonly pulseGain: GainNode;
  private pulseOsc: OscillatorNode | undefined;
  private pulseTimer: ReturnType<typeof setTimeout> | null = null;
  private stingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: BaseAudioContext, cfg: MusicEngineConfig) {
    this.ctx = ctx;
    this.cfg = cfg;
    this.rng = new Prng(7);

    // Two detuned pad drones.
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sine' : 'triangle';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(cfg.busGain);
      this.drones.push({ osc, gain, baseFreq: 110 });
      osc.start();
    }

    // Air layer is continuous so it never pops.
    this.airNoise = new LoopVoice(ctx, cfg.busGain);
    const airSrc = ctx.createBufferSource();
    airSrc.buffer = createNoiseBuffer(ctx, 4, 'pink');
    airSrc.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'lowpass';
    airFilter.frequency.value = 600;
    airSrc.connect(airFilter);
    airFilter.connect(this.airNoise.gain);
    this.airNoise.trackSource(airSrc);
    this.airNoise.addNode(airFilter);
    this.airNoise.start();
    this.airNoise.gain.gain.value = 0;

    // Tense state low pulse.
    this.pulseGain = ctx.createGain();
    this.pulseGain.gain.value = 0;
    this.pulseGain.connect(cfg.busGain);
  }

  setState(state: MusicState): void {
    if (this.state === state) return;
    this.state = state;
    const now = this.ctx.currentTime;
    const fade = state === 'off' ? 0.5 : 3.5;

    // Crossfade drone layer.
    const targetDrones = this.targetDroneVolume(state);
    for (const voice of this.drones) {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(targetDrones, now, fade / 3);
    }

    // Air layer always present at a low level; boost in chamber states.
    const targetAir = state === 'off' ? 0 : state === 'menu' ? 0.12 : 0.18;
    this.airNoise.gain.gain.cancelScheduledValues(now);
    this.airNoise.gain.gain.setTargetAtTime(targetAir, now, fade / 3);

    // Repitch drones for the new state.
    if (state !== 'off') {
      this.scheduleDroneNotes(state, now + fade * 0.5);
    }

    // Pulse only for tense.
    const pulseTarget = state === 'chamber-tense' ? 0.35 : 0;
    this.pulseGain.gain.cancelScheduledValues(now);
    this.pulseGain.gain.setTargetAtTime(pulseTarget, now, fade / 3);
    this.stopPulse();
    if (state === 'chamber-tense') {
      this.startPulse(now);
    }

    // completion resolve: a short bright ping, then settle into calm.
    if (state === 'chamber-complete') {
      this.playSting(now);
      const restore = now + 3.5;
      for (const voice of this.drones) {
        voice.gain.gain.setTargetAtTime(0.08, restore, 2);
      }
      this.airNoise.gain.gain.setTargetAtTime(0.22, restore, 2);
      this.pulseGain.gain.setTargetAtTime(0, restore, 2);
    }
  }

  update(_dtSeconds: number): void {
    // Dynamic subtle detune slowly drifts so the pad never loops.
    if (this.state !== 'off' && this.ctx.currentTime > 0) {
      const t = this.ctx.currentTime;
      for (let i = 0; i < this.drones.length; i++) {
        const voice = this.drones[i];
        const drift = Math.sin(t * 0.07 + i) * 4;
        voice.osc.detune.setTargetAtTime(drift, t, 0.5);
      }
    }
  }

  setVolume(musicVolume: number, masterVolume: number): void {
    const target = musicVolume * masterVolume;
    const now = this.ctx.currentTime;
    this.cfg.busGain.gain.cancelScheduledValues(now);
    this.cfg.busGain.gain.setTargetAtTime(target, now, 0.05);
  }

  dispose(): void {
    this.stopPulse();
    if (this.stingTimer) {
      clearTimeout(this.stingTimer);
      this.stingTimer = null;
    }
    for (const voice of this.drones) {
      voice.osc.stop();
      voice.osc.disconnect();
      voice.gain.disconnect();
    }
    this.airNoise.dispose();
    this.pulseGain.disconnect();
    this.pulseOsc?.disconnect();
  }

  private targetDroneVolume(state: MusicState): number {
    switch (state) {
      case 'menu':
        return 0.18;
      case 'chamber-calm':
        return 0.12;
      case 'chamber-tense':
        return 0.14;
      case 'chamber-complete':
        return 0.28;
      case 'off':
        return 0;
    }
  }

  private scheduleDroneNotes(state: MusicState, when: number): void {
    // Seed from state string to get a stable-but-different chord.
    this.rng = new Prng(seedFromString(state));
    const base = this.rng.range(80, 120);
    const ratios: Record<MusicState, number[]> = {
      menu: [1, 1.5, 2],
      'chamber-calm': [1, 1.2, 1.5],
      'chamber-tense': [1, 1.189, 1.414],
      'chamber-complete': [1, 1.25, 1.5],
      off: [],
    };
    const chord = ratios[state] ?? [1, 1.2];
    for (let i = 0; i < this.drones.length; i++) {
      const voice = this.drones[i];
      const freq = base * chord[i % chord.length];
      voice.osc.frequency.setTargetAtTime(freq, when, 0.5);
    }
  }

  private startPulse(when: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 55;
    osc.connect(this.pulseGain);
    osc.start(when);
    this.pulseOsc = osc;

    const pulse = () => {
      if (this.state !== 'chamber-tense') return;
      const n = this.ctx.currentTime;
      this.pulseGain.gain.cancelScheduledValues(n);
      this.pulseGain.gain.setValueAtTime(0, n);
      this.pulseGain.gain.linearRampToValueAtTime(0.35, n + 0.08);
      this.pulseGain.gain.exponentialRampToValueAtTime(0.001, n + 1.2);
      this.pulseOsc?.frequency.setValueAtTime(this.rng.range(45, 68), n);
      this.pulseTimer = setTimeout(pulse, this.rng.range(1700, 3600));
    };
    this.pulseTimer = setTimeout(pulse, this.rng.range(1200, 2400));
  }

  private stopPulse(): void {
    if (this.pulseTimer) {
      clearTimeout(this.pulseTimer);
      this.pulseTimer = null;
    }
    if (this.pulseOsc) {
      this.pulseOsc.disconnect();
      try {
        this.pulseOsc.stop();
      } catch {
        // Already stopped.
      }
      this.pulseOsc = undefined;
    }
  }

  private playSting(now: number): void {
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.cfg.busGain);
    osc1.connect(g);
    osc2.connect(g);
    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.value = 660;
    osc2.frequency.value = 990;
    osc1.start(now);
    osc2.start(now + 0.08);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.35, now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.6);
    osc1.stop(now + 1.8);
    osc2.stop(now + 1.8);
    // Cleanup without keeping references beyond the dispose timer.
    this.stingTimer = setTimeout(() => {
      osc1.disconnect();
      osc2.disconnect();
      g.disconnect();
    }, 2000);
  }
}

function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return Math.abs(h >>> 0);
}
