/**
 * audio/recipes.ts — Procedural SFX recipes for every canonical sound id.
 *
 * Each entry returns a Voice with its sources already wired; the AudioSystem
 * only schedules it. Loops are handled separately so they can run until stopped.
 */

import { SOUND } from '../core/soundIds';
import type { SoundId } from '../core/soundIds';
import {
  createNoiseBuffer,
  createNoiseBurst,
  detunedBase,
  LoopVoice,
  normalizeVolume,
  scheduleGainEnvelope,
  type EnvelopeSpec,
  type PlayOptions,
  type SynthContext,
  Voice,
} from './synth';

export type SoundRecipe = (ctx: SynthContext, options: PlayOptions) => Voice;
export type LoopRecipe = (ctx: SynthContext) => LoopVoice;

// ---------------------------------------------------------------------------
// Utility helpers (keep recipes short)
// ---------------------------------------------------------------------------

function addNoiseToVoice(
  ctx: SynthContext,
  voice: Voice,
  duration: number,
  color: 'white' | 'pink' | 'brown',
  filterFreq: number,
  filterType: BiquadFilterType,
  env: EnvelopeSpec,
): void {
  // createNoiseBurst creates its own internal gain/filter envelope and starts
  // the source; it is self-contained and must not be re-routed through Voice.
  createNoiseBurst(ctx.ctx, voice.gain, ctx.now, duration, color, filterFreq, filterType, env, voice.addNode.bind(voice));
}

function shortEnvelope(peak = 1): EnvelopeSpec {
  return { attack: 0.001, decay: 0.04, sustain: 0.001, release: 0.05, peak };
}

// ---------------------------------------------------------------------------
// Portal recipes
// ---------------------------------------------------------------------------

const portalFire = (color: 'blue' | 'orange'): SoundRecipe => {
  return (ctx, options) => {
    const mul = color === 'blue' ? 1.25 : 0.85;
    const voice = new Voice(ctx.ctx, ctx.out);
    const now = ctx.now;
    const duration = 0.2;

    const osc = ctx.ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = detunedBase(options, 1200) * mul;
    osc.frequency.setValueAtTime(base * 1.4, now);
    osc.frequency.exponentialRampToValueAtTime(base * 0.6, now + duration * 0.5);
    voice.addSource(osc);

    const noiseEnv: EnvelopeSpec = { attack: 0.001, decay: 0.03, sustain: 0, release: 0.08, peak: 0.35 };
    addNoiseToVoice(ctx, voice, duration, 'white', 800, 'highpass', noiseEnv);

    voice.gain.gain.value = 0;
    scheduleGainEnvelope(voice.gain.gain, shortEnvelope(normalizeVolume(options)), now, duration);
    voice.duration = duration + 0.1;
    return voice;
  };
};

const portalOpen: SoundRecipe = (ctx, options) => {
  const voice = new Voice(ctx.ctx, ctx.out);
  const now = ctx.now;
  const duration = 0.55;
  const vol = normalizeVolume(options);

  const osc1 = ctx.ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(detunedBase(options, 520), now);
  osc1.frequency.exponentialRampToValueAtTime(detunedBase(options, 780), now + duration * 0.4);
  voice.addSource(osc1);

  const osc2 = ctx.ctx.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(detunedBase(options, 260), now);
  osc2.frequency.exponentialRampToValueAtTime(detunedBase(options, 350), now + duration * 0.5);
  voice.addSource(osc2);

  const filterEnv: EnvelopeSpec = { attack: 0.02, decay: 0.3, sustain: 0.05, release: 0.2, peak: vol * 0.7 };
  addNoiseToVoice(ctx, voice, duration, 'pink', 1200, 'bandpass', filterEnv);

  voice.gain.gain.value = 0;
  scheduleGainEnvelope(voice.gain.gain, { attack: 0.01, decay: duration * 0.4, sustain: 0.1, release: 0.25, peak: vol }, now, duration);
  voice.duration = duration + 0.15;
  return voice;
};

const portalClose: SoundRecipe = (ctx, options) => {
  const voice = new Voice(ctx.ctx, ctx.out);
  const duration = 0.45;

  const filterEnv: EnvelopeSpec = { attack: 0.02, decay: 0.25, sustain: 0, release: 0.12, peak: normalizeVolume(options) };
  addNoiseToVoice(ctx, voice, duration, 'brown', 500, 'bandpass', filterEnv);
  voice.duration = duration + 0.1;
  return voice;
};

const portalFizzle: SoundRecipe = (ctx, options) => {
  const voice = new Voice(ctx.ctx, ctx.out);
  const now = ctx.now;
  const duration = 0.42;
  const vol = normalizeVolume(options) * 0.6;

  // Dedicated noise VCA so the LFO only modulates the fizzle layer,
  // not the entire voice master gain.
  const noiseVca = ctx.ctx.createGain();
  noiseVca.connect(voice.gain);

  const filter = ctx.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  filter.Q.value = 1;

  const noiseSrc = ctx.ctx.createBufferSource();
  noiseSrc.buffer = createNoiseBuffer(ctx.ctx, duration + 0.05, 'brown');
  noiseSrc.connect(filter);
  filter.connect(noiseVca);
  noiseSrc.start(now);
  noiseSrc.stop(now + duration + 0.1);

  scheduleGainEnvelope(
    noiseVca.gain,
    { attack: 0.04, decay: 0.2, sustain: 0.1, release: 0.1, peak: vol },
    now,
    duration,
  );
  voice.addNode(filter);
  voice.addNode(noiseVca);

  const lfo = ctx.ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 18;
  const lfoGain = ctx.ctx.createGain();
  lfoGain.gain.value = 300;
  lfo.connect(lfoGain);
  lfoGain.connect(noiseVca.gain);
  lfo.start(now);
  lfo.stop(now + duration + 0.1);

  voice.addNode(lfoGain);
  voice.trackSource(noiseSrc);
  voice.trackSource(lfo);

  voice.duration = duration + 0.15;
  return voice;
};

const portalSweep = (direction: 'enter' | 'exit'): SoundRecipe => {
  return (ctx, options) => {
    const voice = new Voice(ctx.ctx, ctx.out);
    const now = ctx.now;
    const duration = 0.45;
    const startMul = direction === 'enter' ? 1.4 : 0.7;
    const endMul = direction === 'enter' ? 0.6 : 1.2;

    const osc = ctx.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(detunedBase(options, 220) * startMul, now);
    osc.frequency.exponentialRampToValueAtTime(detunedBase(options, 220) * endMul, now + duration);
    voice.addSource(osc);

    const filter = ctx.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 3;
    filter.frequency.setValueAtTime(3000 * startMul, now);
    filter.frequency.exponentialRampToValueAtTime(300 * endMul, now + duration);
    voice.disconnect();
    voice.gain.connect(filter);
    filter.connect(ctx.out);
    voice.addNode(filter);

    const env: EnvelopeSpec = { attack: 0.01, decay: 0.15, sustain: 0.1, release: 0.2, peak: normalizeVolume(options) };
    voice.gain.gain.value = 0;
    scheduleGainEnvelope(voice.gain.gain, env, now, duration);
    voice.duration = duration + 0.15;
    return voice;
  };
};

const objectTeleport: SoundRecipe = (ctx, options) => {
  const voice = new Voice(ctx.ctx, ctx.out);
  const now = ctx.now;
  const duration = 0.28;
  const vol = normalizeVolume(options);

  const osc = ctx.ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(detunedBase(options, 410) * 1.3, now);
  osc.frequency.exponentialRampToValueAtTime(detunedBase(options, 410) * 0.7, now + duration);
  voice.addSource(osc);

  const filter = ctx.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 3;
  filter.frequency.setValueAtTime(2800, now);
  filter.frequency.exponentialRampToValueAtTime(350, now + duration);
  voice.disconnect();
  voice.gain.connect(filter);
  filter.connect(ctx.out);
  voice.addNode(filter);

  voice.gain.gain.value = 0;
  scheduleGainEnvelope(voice.gain.gain, { attack: 0.01, decay: 0.1, sustain: 0.08, release: 0.12, peak: vol }, now, duration);
  voice.duration = duration + 0.1;
  return voice;
};

// ---------------------------------------------------------------------------
// UI / interaction
// ---------------------------------------------------------------------------

function uiBlip(baseHz: number): SoundRecipe {
  return (ctx, options) => {
    const voice = new Voice(ctx.ctx, ctx.out);
    const duration = 0.07;
    const osc = ctx.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = detunedBase(options, baseHz);
    voice.addSource(osc);
    voice.gain.gain.value = 0;
    scheduleGainEnvelope(voice.gain.gain, { attack: 0.001, decay: 0.025, sustain: 0, release: 0.04, peak: normalizeVolume(options) * 0.7 }, ctx.now, duration);
    voice.duration = duration + 0.05;
    return voice;
  };
}

// ---------------------------------------------------------------------------
// Button, door, cubes
// ---------------------------------------------------------------------------

const buttonPress: SoundRecipe = (ctx, options) => {
  const voice = new Voice(ctx.ctx, ctx.out);
  const now = ctx.now;
  const duration = 0.14;

  const clunk = ctx.ctx.createOscillator();
  clunk.type = 'square';
  clunk.frequency.setValueAtTime(detunedBase(options, 110), now);
  clunk.frequency.exponentialRampToValueAtTime(detunedBase(options, 55), now + 0.06);
  voice.addSource(clunk);

  const spring = ctx.ctx.createOscillator();
  spring.type = 'sine';
  spring.frequency.setValueAtTime(detunedBase(options, 650), now + 0.04);
  spring.frequency.exponentialRampToValueAtTime(detunedBase(options, 520), now + 0.1);
  voice.addSource(spring);

  voice.gain.gain.value = 0;
  scheduleGainEnvelope(voice.gain.gain, { attack: 0.001, decay: 0.05, sustain: 0.02, release: 0.04, peak: normalizeVolume(options) }, now, duration);
  voice.duration = duration + 0.05;
  return voice;
};

const buttonRelease: SoundRecipe = (ctx, options) => {
  const voice = new Voice(ctx.ctx, ctx.out);
  const now = ctx.now;
  const duration = 0.12;

  const spring = ctx.ctx.createOscillator();
  spring.type = 'sine';
  spring.frequency.setValueAtTime(detunedBase(options, 720), now);
  spring.frequency.exponentialRampToValueAtTime(detunedBase(options, 900), now + 0.04);
  voice.addSource(spring);

  const thunk = ctx.ctx.createOscillator();
  thunk.type = 'triangle';
  thunk.frequency.value = detunedBase(options, 90);
  voice.addSource(thunk);

  voice.gain.gain.value = 0;
  scheduleGainEnvelope(voice.gain.gain, { attack: 0.002, decay: 0.03, sustain: 0.01, release: 0.05, peak: normalizeVolume(options) * 0.8 }, now, duration);
  voice.duration = duration + 0.05;
  return voice;
};

function doorRecipe(kind: 'open' | 'close'): SoundRecipe {
  return (ctx, options) => {
    const voice = new Voice(ctx.ctx, ctx.out);
    const now = ctx.now;
    const duration = kind === 'open' ? 1.1 : 0.9;
    const low = kind === 'open' ? 150 : 300;
    const high = kind === 'open' ? 1200 : 400;

    const osc = ctx.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(detunedBase(options, low), now);
    osc.frequency.exponentialRampToValueAtTime(detunedBase(options, high), now + duration * 0.7);
    voice.addSource(osc);

    const filter = ctx.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.5;
    filter.frequency.setValueAtTime(low, now);
    filter.frequency.linearRampToValueAtTime(high, now + duration * 0.8);
    voice.disconnect();
    voice.gain.connect(filter);
    filter.connect(ctx.out);
    voice.addNode(filter);

    const sealEnv: EnvelopeSpec = { attack: 0.02, decay: 0.1, sustain: 0, release: 0.05, peak: normalizeVolume(options) * 0.3 };
    addNoiseToVoice(ctx, voice, 0.15, 'pink', 1500, 'highpass', sealEnv);

    voice.gain.gain.value = 0;
    scheduleGainEnvelope(voice.gain.gain, { attack: 0.02, decay: duration * 0.5, sustain: 0.05, release: 0.12, peak: normalizeVolume(options) }, now, duration);
    voice.duration = duration + 0.15;
    return voice;
  };
}

const cubePickup: SoundRecipe = (ctx, options) => {
  const voice = new Voice(ctx.ctx, ctx.out);
  const now = ctx.now;
  const duration = 0.16;

  const osc = ctx.ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(detunedBase(options, 220), now);
  osc.frequency.exponentialRampToValueAtTime(detunedBase(options, 330), now + 0.06);
  voice.addSource(osc);

  const env: EnvelopeSpec = { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05, peak: normalizeVolume(options) * 0.4 };
  addNoiseToVoice(ctx, voice, duration, 'pink', 1800, 'bandpass', env);

  voice.gain.gain.value = 0;
  scheduleGainEnvelope(voice.gain.gain, shortEnvelope(normalizeVolume(options)), now, duration);
  voice.duration = duration + 0.05;
  return voice;
};

function cubeThunk(pitchMul: number, hardness: number): SoundRecipe {
  return (ctx, options) => {
    const voice = new Voice(ctx.ctx, ctx.out);
    const now = ctx.now;
    const duration = 0.12;
    const vol = normalizeVolume(options);

    const osc = ctx.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(detunedBase(options, 180) * pitchMul, now);
    osc.frequency.exponentialRampToValueAtTime(detunedBase(options, 120) * pitchMul, now + 0.06);
    voice.addSource(osc);

    const noiseEnv: EnvelopeSpec = { attack: 0.001, decay: 0.03, sustain: 0, release: 0.04, peak: vol * hardness };
    addNoiseToVoice(ctx, voice, duration, 'white', 1200, 'lowpass', noiseEnv);

    voice.gain.gain.value = 0;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(0, now);
    voice.gain.gain.linearRampToValueAtTime(vol, now + 0.005);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    voice.duration = duration + 0.05;
    return voice;
  };
}

const cubeFizzle: SoundRecipe = (ctx, options) => {
  const voice = new Voice(ctx.ctx, ctx.out);
  const now = ctx.now;
  const duration = 0.55;
  const vol = normalizeVolume(options);

  const noiseEnv: EnvelopeSpec = { attack: 0.05, decay: 0.25, sustain: 0.15, release: 0.18, peak: vol };
  addNoiseToVoice(ctx, voice, duration, 'pink', 1200, 'highpass', noiseEnv);

  const crackle = ctx.ctx.createOscillator();
  crackle.type = 'square';
  crackle.frequency.value = detunedBase(options, 90);
  voice.addSource(crackle);

  voice.gain.gain.value = 0;
  voice.gain.gain.cancelScheduledValues(now);
  voice.gain.gain.setValueAtTime(0, now);
  voice.gain.gain.linearRampToValueAtTime(vol, now + 0.03);
  voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  voice.duration = duration + 0.1;
  return voice;
};

const dispenserDrop: SoundRecipe = (ctx, options) => {
  const voice = new Voice(ctx.ctx, ctx.out);
  const now = ctx.now;
  const duration = 0.55;
  const vol = normalizeVolume(options);

  const osc = ctx.ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(detunedBase(options, 160), now);
  osc.frequency.exponentialRampToValueAtTime(detunedBase(options, 70), now + duration * 0.7);
  voice.addSource(osc);

  const noiseEnv: EnvelopeSpec = { attack: 0.01, decay: 0.25, sustain: 0.05, release: 0.1, peak: vol * 0.5 };
  addNoiseToVoice(ctx, voice, duration, 'brown', 600, 'bandpass', noiseEnv);

  voice.gain.gain.value = 0;
  scheduleGainEnvelope(voice.gain.gain, { attack: 0.001, decay: duration * 0.35, sustain: 0.15, release: 0.12, peak: vol }, now, duration);
  voice.duration = duration + 0.12;
  return voice;
};

// ---------------------------------------------------------------------------
// Loops
// ---------------------------------------------------------------------------

const laserHum: LoopRecipe = (ctx) => {
  const loop = new LoopVoice(ctx.ctx, ctx.out);
  const freq = 150;
  const root = ctx.ctx.createOscillator();
  root.type = 'sawtooth';
  root.frequency.value = freq;
  root.detune.value = -5;
  loop.addSource(root);

  const fifth = ctx.ctx.createOscillator();
  fifth.type = 'square';
  fifth.frequency.value = freq * 1.5;
  fifth.detune.value = 4;
  loop.addSource(fifth);

  const noiseSrc = ctx.ctx.createBufferSource();
  noiseSrc.buffer = createNoiseBuffer(ctx.ctx, 2, 'pink');
  noiseSrc.loop = true;
  const filter = ctx.ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 300;
  filter.Q.value = 4;
  noiseSrc.connect(filter);
  filter.connect(loop.gain);
  loop.trackSource(noiseSrc);
  loop.addNode(filter);

  loop.gain.gain.value = 0.18;
  return loop;
};

const laserKill: SoundRecipe = (ctx, options) => {
  const voice = new Voice(ctx.ctx, ctx.out);
  const now = ctx.now;
  const duration = 0.28;
  const vol = normalizeVolume(options);

  const osc = ctx.ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(detunedBase(options, 900), now);
  osc.frequency.exponentialRampToValueAtTime(detunedBase(options, 2000), now + duration * 0.4);
  voice.addSource(osc);

  const env: EnvelopeSpec = { attack: 0.005, decay: 0.08, sustain: 0.05, release: 0.12, peak: vol };
  addNoiseToVoice(ctx, voice, duration, 'white', 2000, 'highpass', env);

  voice.gain.gain.value = 0;
  scheduleGainEnvelope(voice.gain.gain, { attack: 0.002, decay: 0.06, sustain: 0.02, release: 0.1, peak: vol }, now, duration);
  voice.duration = duration + 0.1;
  return voice;
};

function airyLoop(filterFreq: number, gainValue: number, color: 'white' | 'pink' = 'white'): LoopRecipe {
  return (ctx) => {
    const loop = new LoopVoice(ctx.ctx, ctx.out);
    const src = ctx.ctx.createBufferSource();
    src.buffer = createNoiseBuffer(ctx.ctx, 2, color);
    src.loop = true;
    const filter = ctx.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 0.7;
    src.connect(filter);
    filter.connect(loop.gain);
    loop.trackSource(src);
    loop.addNode(filter);

    const shimmer = ctx.ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.value = filterFreq * (color === 'white' ? 2 : 1.25);
    loop.addSource(shimmer);

    loop.gain.gain.value = gainValue;
    return loop;
  };
}

const platformMove: LoopRecipe = (ctx) => {
  const loop = new LoopVoice(ctx.ctx, ctx.out);
  const osc = ctx.ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 80;
  osc.detune.value = -8;
  loop.addSource(osc);

  const noiseSrc = ctx.ctx.createBufferSource();
  noiseSrc.buffer = createNoiseBuffer(ctx.ctx, 1.5, 'pink');
  noiseSrc.loop = true;
  const filter = ctx.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 350;
  noiseSrc.connect(filter);
  filter.connect(loop.gain);
  loop.trackSource(noiseSrc);
  loop.addNode(filter);

  loop.gain.gain.value = 0.12;
  return loop;
};

const faithPlateLaunch: SoundRecipe = (ctx, options) => {
  const voice = new Voice(ctx.ctx, ctx.out);
  const now = ctx.now;
  const duration = 0.42;
  const vol = normalizeVolume(options);

  const boing = ctx.ctx.createOscillator();
  boing.type = 'sine';
  boing.frequency.setValueAtTime(detunedBase(options, 160), now);
  boing.frequency.exponentialRampToValueAtTime(detunedBase(options, 55), now + duration * 0.35);
  voice.addSource(boing);

  const spring = ctx.ctx.createOscillator();
  spring.type = 'triangle';
  spring.frequency.setValueAtTime(detunedBase(options, 520), now);
  spring.frequency.exponentialRampToValueAtTime(detunedBase(options, 240), now + 0.08);
  voice.addSource(spring);

  const env: EnvelopeSpec = { attack: 0.005, decay: 0.08, sustain: 0, release: 0.1, peak: vol };
  addNoiseToVoice(ctx, voice, duration, 'pink', 800, 'bandpass', env);

  voice.gain.gain.value = 0;
  scheduleGainEnvelope(voice.gain.gain, { attack: 0.003, decay: 0.1, sustain: 0, release: 0.18, peak: vol }, now, duration);
  voice.duration = duration + 0.1;
  return voice;
};

// ---------------------------------------------------------------------------
// Player / environment
// ---------------------------------------------------------------------------

const playerStep: SoundRecipe = (ctx, options) => {
  const voice = new Voice(ctx.ctx, ctx.out);
  const now = ctx.now;
  const duration = 0.08;
  const vol = normalizeVolume(options) * (0.85 + Math.random() * 0.3);
  const pitch = options?.pitch ?? 1;

  const osc = ctx.ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = detunedBase(options, 180) * pitch * (0.96 + Math.random() * 0.08);
  voice.addSource(osc);

  const noiseEnv: EnvelopeSpec = { attack: 0.001, decay: 0.025, sustain: 0, release: 0.03, peak: vol * 0.4 };
  addNoiseToVoice(ctx, voice, duration, 'pink', 900, 'highpass', noiseEnv);

  voice.gain.gain.value = 0;
  scheduleGainEnvelope(voice.gain.gain, shortEnvelope(vol), now, duration);
  voice.duration = duration + 0.05;
  return voice;
};

const playerJump: SoundRecipe = (ctx, options) => {
  const voice = new Voice(ctx.ctx, ctx.out);
  const now = ctx.now;
  const duration = 0.22;
  const vol = normalizeVolume(options);

  const env: EnvelopeSpec = { attack: 0.01, decay: 0.08, sustain: 0, release: 0.1, peak: vol * 0.45 };
  addNoiseToVoice(ctx, voice, duration, 'pink', 900, 'bandpass', env);

  const osc = ctx.ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(detunedBase(options, 120), now);
  osc.frequency.exponentialRampToValueAtTime(detunedBase(options, 220), now + duration);
  voice.addSource(osc);

  voice.gain.gain.value = 0;
  scheduleGainEnvelope(voice.gain.gain, { attack: 0.01, decay: 0.08, sustain: 0, release: 0.12, peak: vol }, now, duration);
  voice.duration = duration + 0.1;
  return voice;
};

const playerLand: SoundRecipe = (ctx, options) => {
  const voice = new Voice(ctx.ctx, ctx.out);
  const now = ctx.now;
  const duration = 0.22;
  const vol = normalizeVolume(options);

  const osc = ctx.ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(detunedBase(options, 100), now);
  osc.frequency.exponentialRampToValueAtTime(detunedBase(options, 60), now + 0.12);
  voice.addSource(osc);

  const noiseEnv: EnvelopeSpec = { attack: 0.001, decay: 0.06, sustain: 0, release: 0.05, peak: vol * 0.5 };
  addNoiseToVoice(ctx, voice, duration, 'brown', 600, 'lowpass', noiseEnv);

  voice.gain.gain.value = 0;
  voice.gain.gain.cancelScheduledValues(now);
  voice.gain.gain.setValueAtTime(0, now);
  voice.gain.gain.linearRampToValueAtTime(vol, now + 0.003);
  voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  voice.duration = duration + 0.05;
  return voice;
};

const gooDeath: SoundRecipe = (ctx, options) => {
  const voice = new Voice(ctx.ctx, ctx.out);
  const now = ctx.now;
  const duration = 0.55;
  const vol = normalizeVolume(options);

  const env: EnvelopeSpec = { attack: 0.02, decay: 0.2, sustain: 0.1, release: 0.15, peak: vol };
  addNoiseToVoice(ctx, voice, duration, 'brown', 800, 'lowpass', env);

  const bubble = ctx.ctx.createOscillator();
  bubble.type = 'sine';
  bubble.frequency.setValueAtTime(detunedBase(options, 80), now);
  bubble.frequency.linearRampToValueAtTime(detunedBase(options, 60), now + duration * 0.5);
  bubble.frequency.exponentialRampToValueAtTime(detunedBase(options, 30), now + duration);
  voice.addSource(bubble);

  voice.gain.gain.value = 0;
  scheduleGainEnvelope(voice.gain.gain, { attack: 0.01, decay: duration * 0.5, sustain: 0.15, release: 0.15, peak: vol }, now, duration);
  voice.duration = duration + 0.12;
  return voice;
};

// ---------------------------------------------------------------------------
// Elevator + ambient + completion
// ---------------------------------------------------------------------------

const elevatorLoop: LoopRecipe = (ctx) => {
  const loop = new LoopVoice(ctx.ctx, ctx.out);
  const motor = ctx.ctx.createOscillator();
  motor.type = 'sine';
  motor.frequency.value = 70;
  loop.addSource(motor);

  const rail = ctx.ctx.createOscillator();
  rail.type = 'sawtooth';
  rail.frequency.value = 180;
  rail.detune.value = 6;
  loop.addSource(rail);

  const noiseSrc = ctx.ctx.createBufferSource();
  noiseSrc.buffer = createNoiseBuffer(ctx.ctx, 2, 'pink');
  noiseSrc.loop = true;
  const filter = ctx.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 400;
  noiseSrc.connect(filter);
  filter.connect(loop.gain);
  loop.trackSource(noiseSrc);
  loop.addNode(filter);

  loop.gain.gain.value = 0.1;
  return loop;
};

const chamberComplete: SoundRecipe = (ctx, options) => {
  const voice = new Voice(ctx.ctx, ctx.out);
  const now = ctx.now;
  const duration = 0.55;
  const vol = normalizeVolume(options);

  const note1 = ctx.ctx.createOscillator();
  note1.type = 'sine';
  note1.frequency.value = detunedBase(options, 880);
  note1.detune.value = 6;
  voice.addSource(note1);

  const note2 = ctx.ctx.createOscillator();
  note2.type = 'sine';
  note2.frequency.value = detunedBase(options, 440 * 1.25); // E-ish major third
  note2.detune.value = -4;
  voice.addSource(note2);

  voice.gain.gain.value = 0;
  scheduleGainEnvelope(voice.gain.gain, { attack: 0.02, decay: 0.08, sustain: 0.6, release: 0.35, peak: vol }, now, duration);
  voice.duration = duration + 0.2;
  return voice;
};

const ambientHum: LoopRecipe = (ctx) => {
  const loop = new LoopVoice(ctx.ctx, ctx.out);
  const src = ctx.ctx.createBufferSource();
  src.buffer = createNoiseBuffer(ctx.ctx, 3, 'brown');
  src.loop = true;
  const filter = ctx.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 180;
  src.connect(filter);
  filter.connect(loop.gain);
  loop.trackSource(src);
  loop.addNode(filter);

  const buzz = ctx.ctx.createOscillator();
  buzz.type = 'square';
  buzz.frequency.value = 60;
  buzz.detune.value = -10;
  const buzzGain = ctx.ctx.createGain();
  buzzGain.gain.value = 0.04;
  buzz.connect(buzzGain);
  buzzGain.connect(loop.gain);
  loop.trackSource(buzz);
  loop.addNode(buzzGain);

  loop.gain.gain.value = 0.25;
  return loop;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const RECIPE_TABLE: Partial<Record<SoundId, SoundRecipe>> = {
  [SOUND.portalFireBlue]: portalFire('blue'),
  [SOUND.portalFireOrange]: portalFire('orange'),
  [SOUND.portalOpen]: portalOpen,
  [SOUND.portalClose]: portalClose,
  [SOUND.portalEnter]: portalSweep('enter'),
  [SOUND.portalExit]: portalSweep('exit'),
  [SOUND.portalFizzle]: portalFizzle,
  [SOUND.objectTeleport]: objectTeleport,

  [SOUND.uiClick]: uiBlip(1200),
  [SOUND.uiHover]: uiBlip(2200),

  [SOUND.buttonPress]: buttonPress,
  [SOUND.buttonRelease]: buttonRelease,
  [SOUND.doorOpen]: doorRecipe('open'),
  [SOUND.doorClose]: doorRecipe('close'),

  [SOUND.cubePickup]: cubePickup,
  [SOUND.cubeDrop]: cubeThunk(0.85, 0.5),
  [SOUND.cubeBounce]: cubeThunk(1.1, 0.35),
  [SOUND.cubeFizzle]: cubeFizzle,
  [SOUND.dispenserDrop]: dispenserDrop,

  [SOUND.laserKill]: laserKill,
  [SOUND.faithPlateLaunch]: faithPlateLaunch,

  [SOUND.playerStep]: playerStep,
  [SOUND.playerJump]: playerJump,
  [SOUND.playerLand]: playerLand,
  [SOUND.gooDeath]: gooDeath,

  [SOUND.chamberComplete]: chamberComplete,
} as const;

const LOOP_RECIPE_TABLE: Record<string, LoopRecipe> = {
  [SOUND.laserHum]: laserHum,
  [SOUND.funnelLoop]: airyLoop(800, 0.18),
  [SOUND.bridgeLoop]: airyLoop(2200, 0.15),
  [SOUND.platformMove]: platformMove,
  [SOUND.elevatorLoop]: elevatorLoop,
  [SOUND.ambientHum]: ambientHum,
};

export function getRecipe(id: string): SoundRecipe | undefined {
  return RECIPE_TABLE[id as SoundId];
}

export function getLoopRecipe(id: string): LoopRecipe | undefined {
  return LOOP_RECIPE_TABLE[id];
}

export function isLoop(id: string): boolean {
  return id in LOOP_RECIPE_TABLE;
}

export function getRecipeIds(): readonly string[] {
  return Object.keys(RECIPE_TABLE);
}

export function getLoopRecipeIds(): readonly string[] {
  return Object.keys(LOOP_RECIPE_TABLE);
}
