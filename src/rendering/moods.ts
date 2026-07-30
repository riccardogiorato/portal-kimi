/**
 * rendering/moods.ts — Chamber mood definitions and transitions (pure).
 *
 * A mood is a bundle of lighting/exposure targets. RenderingSystem damps a
 * live copy toward the active target every frame (core/math `damp`), so
 * setMood cross-fades smoothly instead of snapping. `exposureMultiplier`
 * scales CONFIG.rendering.exposure so Config stays the single source of
 * truth for the base look.
 */
import { damp } from '../core/math';
import type { ChamberMood } from '../core/types';
import { hash2i } from './procedural/random';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface MoodTargets {
  keyIntensity: number;
  keyColor: Rgb;
  hemiIntensity: number;
  hemiSky: Rgb;
  hemiGround: Rgb;
  environmentIntensity: number;
  /** Multiplies CONFIG.rendering.exposure. */
  exposureMultiplier: number;
  clearColor: Rgb;
  /** 0 = rock steady; 1 = full fluorescent dropouts (damaged chambers). */
  flicker: number;
}

export const MOOD_TARGETS: Record<ChamberMood, MoodTargets> = {
  clean: {
    keyIntensity: 1.05,
    keyColor: { r: 1.0, g: 0.975, b: 0.93 },
    hemiIntensity: 0.5,
    hemiSky: { r: 0.74, g: 0.79, b: 0.9 },
    hemiGround: { r: 0.3, g: 0.29, b: 0.28 },
    environmentIntensity: 0.9,
    exposureMultiplier: 1.0,
    clearColor: { r: 0.012, g: 0.016, b: 0.028 },
    flicker: 0,
  },
  damaged: {
    keyIntensity: 0.6,
    keyColor: { r: 1.0, g: 0.83, b: 0.62 },
    hemiIntensity: 0.32,
    hemiSky: { r: 0.58, g: 0.52, b: 0.44 },
    hemiGround: { r: 0.2, g: 0.16, b: 0.12 },
    environmentIntensity: 0.6,
    exposureMultiplier: 0.94,
    clearColor: { r: 0.014, g: 0.012, b: 0.016 },
    flicker: 0.4,
  },
  dark: {
    keyIntensity: 0.14,
    keyColor: { r: 1.0, g: 0.5, b: 0.22 },
    hemiIntensity: 0.14,
    hemiSky: { r: 0.4, g: 0.22, b: 0.12 },
    hemiGround: { r: 0.06, g: 0.035, b: 0.02 },
    environmentIntensity: 0.3,
    exposureMultiplier: 0.88,
    clearColor: { r: 0.006, g: 0.005, b: 0.008 },
    flicker: 0,
  },
};

/** Deep-copy a mood bundle (the live damped state must never alias the consts). */
export function cloneMood(mood: MoodTargets): MoodTargets {
  return {
    keyIntensity: mood.keyIntensity,
    keyColor: { ...mood.keyColor },
    hemiIntensity: mood.hemiIntensity,
    hemiSky: { ...mood.hemiSky },
    hemiGround: { ...mood.hemiGround },
    environmentIntensity: mood.environmentIntensity,
    exposureMultiplier: mood.exposureMultiplier,
    clearColor: { ...mood.clearColor },
    flicker: mood.flicker,
  };
}

function dampRgb(current: Rgb, target: Rgb, lambda: number, dt: number): void {
  current.r = damp(current.r, target.r, lambda, dt);
  current.g = damp(current.g, target.g, lambda, dt);
  current.b = damp(current.b, target.b, lambda, dt);
}

/** Framerate-independent exponential approach of every field toward target. */
export function dampMoodInPlace(current: MoodTargets, target: MoodTargets, lambda: number, dt: number): void {
  current.keyIntensity = damp(current.keyIntensity, target.keyIntensity, lambda, dt);
  current.hemiIntensity = damp(current.hemiIntensity, target.hemiIntensity, lambda, dt);
  current.environmentIntensity = damp(current.environmentIntensity, target.environmentIntensity, lambda, dt);
  current.exposureMultiplier = damp(current.exposureMultiplier, target.exposureMultiplier, lambda, dt);
  current.flicker = damp(current.flicker, target.flicker, lambda, dt);
  dampRgb(current.keyColor, target.keyColor, lambda, dt);
  dampRgb(current.hemiSky, target.hemiSky, lambda, dt);
  dampRgb(current.hemiGround, target.hemiGround, lambda, dt);
  dampRgb(current.clearColor, target.clearColor, lambda, dt);
}

/** Flicker quanta per second — fluorescent-tube rate. */
const FLICKER_RATE = 11;
/** Fraction of quanta that become hard dropouts. */
const DROPOUT_CHANCE = 0.1;

/**
 * Deterministic light-flicker multiplier in [1 - amount, 1]. Time is
 * quantized at FLICKER_RATE and each quantum is hashed: some quanta dip hard,
 * the rest wobble mildly. No state, no allocation, stable across machines.
 */
export function flickerMultiplier(timeSeconds: number, amount: number): number {
  if (amount <= 0) return 1;
  const quantum = Math.floor(timeSeconds * FLICKER_RATE);
  if (hash2i(quantum, 17, 991) < DROPOUT_CHANCE) {
    return 1 - amount;
  }
  const wobble = hash2i(quantum, 41, 557);
  return 1 - amount * 0.35 * wobble;
}
