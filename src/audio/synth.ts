/**
 * audio/synth.ts — Procedural WebAudio synthesis toolkit.
 *
 * Pure envelope/noise helpers + voice classes used by SFX recipes, loops,
 * and the music engine. No external assets; everything is generated at runtime.
 */

import { Vector3 } from '@babylonjs/core';

export interface PlayOptions {
  volume?: number;
  pitch?: number;
}

export interface SynthContext {
  readonly ctx: BaseAudioContext;
  readonly out: AudioNode;
  readonly now: number;
}

export interface EnvelopeSpec {
  /** Seconds from silence to peak. */
  attack: number;
  /** Seconds from peak to sustain level. */
  decay: number;
  /** Sustain level as ratio of peak. */
  sustain: number;
  /** Seconds from sustain to silence after note end. */
  release: number;
  /** Peak gain (0..N, recipes usually 1). */
  peak?: number;
}

/**
 * Pure envelope value for a given spec at time t.
 * Useful for tests and for visually verifying procedural curves.
 */
export function envelopeValue(t: number, duration: number, spec: EnvelopeSpec): number {
  const peak = spec.peak ?? 1;
  const a = Math.max(0, spec.attack);
  const d = Math.max(0, spec.decay);
  const r = Math.max(0, spec.release);
  const sustain = Math.max(0, Math.min(peak, spec.sustain));
  const sustainStart = a + d;
  const releaseStart = Math.max(sustainStart, duration - r);

  if (t < 0) return 0;
  if (a > 0 && t < a) return (t / a) * peak;
  if (d > 0 && t < sustainStart) return peak - ((t - a) / d) * (peak - sustain);
  if (t < releaseStart) return sustain;
  if (r > 0 && t < duration) return sustain * (1 - (t - releaseStart) / r);
  return 0;
}

export function scheduleGainEnvelope(
  param: AudioParam,
  spec: EnvelopeSpec,
  now: number,
  duration: number,
): number {
  const peak = spec.peak ?? 1;
  const a = Math.max(0, spec.attack);
  const d = Math.max(0, spec.decay);
  const r = Math.max(0, spec.release);
  const sustain = Math.max(0, Math.min(peak, spec.sustain));
  const releaseStart = Math.max(a + d, duration - r);

  param.cancelScheduledValues(now);
  param.setValueAtTime(0, now);
  if (a > 0) {
    param.linearRampToValueAtTime(peak, now + a);
  } else {
    param.setValueAtTime(peak, now);
  }
  const decayEnd = now + a + d;
  if (d > 0) {
    param.exponentialRampToValueAtTime(Math.max(1e-4, sustain), decayEnd);
  } else if (a > 0) {
    param.setValueAtTime(Math.max(1e-4, sustain), decayEnd);
  }
  param.setValueAtTime(Math.max(1e-4, sustain), now + releaseStart);
  param.exponentialRampToValueAtTime(0.0001, now + duration);
  return now + duration;
}

/** Multiplier applied to option pitch; a few recipes use a fixed thematic base. */
export function detunedBase(options: PlayOptions, baseHz: number): number {
  return baseHz * (options.pitch ?? 1);
}

export function normalizeVolume(options: PlayOptions): number {
  const v = options.volume ?? 1;
  return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// Noise generation
// ---------------------------------------------------------------------------

export type NoiseColor = 'white' | 'pink' | 'brown';

export function fillNoiseChannel(data: Float32Array, color: NoiseColor): void {
  switch (color) {
    case 'white': {
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      break;
    }
    case 'pink': {
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        const out = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
        data[i] = Math.max(-1, Math.min(1, out));
      }
      break;
    }
    case 'brown': {
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = Math.max(-1, Math.min(1, last * 3.5));
      }
      break;
    }
  }
}

export function createNoiseBuffer(ctx: BaseAudioContext, duration: number, color: NoiseColor): AudioBuffer {
  const channels = 1;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(channels, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  fillNoiseChannel(data, color);
  return buffer;
}

/** Create a one-shot noise burst that already schedules. */
export function createNoiseBurst(
  ctx: BaseAudioContext,
  out: AudioNode,
  now: number,
  duration: number,
  color: NoiseColor,
  filterFreq: number,
  filterType: BiquadFilterType,
  envelope: EnvelopeSpec,
  registerNode?: (node: AudioNode) => void,
): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = createNoiseBuffer(ctx, duration + 0.05, color);
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  filter.Q.value = 1;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(out);
  scheduleGainEnvelope(gain.gain, envelope, now, duration);
  src.start(now);
  src.stop(now + duration + 0.1);
  registerNode?.(src);
  registerNode?.(filter);
  registerNode?.(gain);
  return src;
}

// ---------------------------------------------------------------------------
// Voice abstractions
// ---------------------------------------------------------------------------

export class Voice {
  readonly ctx: BaseAudioContext;
  readonly gain: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly extraSources: AudioScheduledSourceNode[] = [];
  private readonly managedNodes: AudioNode[] = [];
  duration = 0;

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.connect(out);
  }

  addSource(src: AudioScheduledSourceNode): void {
    src.connect(this.gain);
    this.sources.push(src);
  }

  /** Register a source already wired through custom filters/effects. */
  trackSource(src: AudioScheduledSourceNode): void {
    this.extraSources.push(src);
  }

  /** Track every non-source AudioNode so dispose() can tear down the full chain. */
  addNode(node: AudioNode): void {
    this.managedNodes.push(node);
  }

  /** Disconnect the master gain from any downstream filters without disposing sources. */
  disconnect(): void {
    this.gain.disconnect();
  }

  start(when?: number): void {
    for (const src of this.sources) {
      src.start(when);
    }
  }

  stop(when?: number): void {
    for (const src of this.sources) {
      try {
        src.stop(when);
      } catch {
        // Already stopped or never started.
      }
    }
    for (const src of this.extraSources) {
      try {
        src.stop(when);
      } catch {
        // Already stopped or never started.
      }
    }
  }

  dispose(): void {
    this.stop();
    this.gain.disconnect();
    for (const node of this.managedNodes) {
      node.disconnect();
    }
    for (const src of this.sources) {
      src.disconnect();
    }
    for (const src of this.extraSources) {
      src.disconnect();
    }
  }
}

/** A voice intended to run continuously until stopped. */
export class LoopVoice {
  readonly ctx: BaseAudioContext;
  readonly gain: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly managedNodes: AudioNode[] = [];
  private started = false;

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.connect(out);
  }

  addSource(src: AudioScheduledSourceNode, loop?: boolean): void {
    if (loop && 'loop' in src) {
      (src as AudioBufferSourceNode).loop = true;
    }
    src.connect(this.gain);
    this.sources.push(src);
  }

  /** Register a source already wired through custom filters/effects. */
  trackSource(src: AudioScheduledSourceNode): void {
    this.sources.push(src);
  }

  /** Track every non-source AudioNode so dispose() can tear down the full chain. */
  addNode(node: AudioNode): void {
    this.managedNodes.push(node);
  }

  start(when?: number): void {
    if (this.started) return;
    this.started = true;
    for (const src of this.sources) {
      src.start(when);
    }
  }

  stop(when?: number): void {
    for (const src of this.sources) {
      try {
        src.stop(when);
      } catch {
        // Already stopped.
      }
    }
  }

  fadeOut(durationSeconds: number): void {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    const tau = Math.max(0.001, durationSeconds / 3);
    this.gain.gain.setTargetAtTime(0, now, tau);
  }

  dispose(): void {
    this.stop();
    for (const node of this.managedNodes) {
      node.disconnect();
    }
    this.gain.disconnect();
    for (const src of this.sources) {
      src.disconnect();
    }
  }
}

// ---------------------------------------------------------------------------
// Spatial helpers
// ---------------------------------------------------------------------------

export function createPanner(
  ctx: BaseAudioContext,
  refDistance: number,
  maxDistance: number,
  rolloffFactor: number,
  position: Vector3,
): PannerNode {
  const panner = ctx.createPanner();
  panner.panningModel = 'equalpower';
  panner.distanceModel = 'inverse';
  panner.refDistance = refDistance;
  panner.maxDistance = maxDistance;
  panner.rolloffFactor = rolloffFactor;
  panner.positionX.value = position.x;
  panner.positionY.value = position.y;
  panner.positionZ.value = position.z;
  return panner;
}

export function updatePannerPosition(panner: PannerNode, position: Vector3): void {
  panner.positionX.setValueAtTime(position.x, panner.context.currentTime);
  panner.positionY.setValueAtTime(position.y, panner.context.currentTime);
  panner.positionZ.setValueAtTime(position.z, panner.context.currentTime);
}
