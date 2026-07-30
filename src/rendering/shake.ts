/**
 * rendering/shake.ts — Trauma-based screen shake (pure math, no Babylon).
 *
 * shake(intensity) accumulates trauma; the per-frame rotational offset is
 * trauma² × smooth deterministic noise, so small hits are subtle and big
 * hits decay with a long tail. RenderingSystem applies the offset additively
 * to the camera AFTER the player controller has written its rotation, and
 * removes the previous frame's offset first — the two never fight.
 */
import { clamp } from '../core/math';

export interface ShakeOffset {
  pitch: number;
  yaw: number;
  roll: number;
}

/** Max rotational amplitude (radians) at trauma = 1. Small on purpose:
 * Portal-style feedback is a kick, not an earthquake. */
export const SHAKE_MAX_PITCH = 0.028;
export const SHAKE_MAX_YAW = 0.028;
export const SHAKE_MAX_ROLL = 0.04;
/** Trauma units lost per second: a full hit settles in ~0.6s. */
export const SHAKE_DECAY_PER_SECOND = 1.6;
/** Base noise rate; multiplied by irrational-ish factors per axis. */
const NOISE_RATE = 21;

/**
 * Smooth band-limited noise in [-1, 1] from three incommensurate sines.
 * Deterministic (no RNG state) and allocation-free.
 */
export function shakeNoise(t: number, seed: number): number {
  const v =
    Math.sin(t * 1.13 + seed) * 0.55 +
    Math.sin(t * 2.71 + seed * 1.7) * 0.3 +
    Math.sin(t * 4.33 + seed * 2.9) * 0.15;
  // Theoretical max |v| is 1.0; clamp guards floating-point edge cases.
  return clamp(v, -1, 1);
}

export class ScreenShake {
  private trauma = 0;
  private time = 0;

  /** Add a shake impulse; intensity is clamped so stacked hits cap at 1. */
  add(intensity: number): void {
    if (!Number.isFinite(intensity) || intensity <= 0) return;
    this.trauma = clamp(this.trauma + intensity, 0, 1);
  }

  get currentTrauma(): number {
    return this.trauma;
  }

  reset(): void {
    this.trauma = 0;
  }

  /** Advance time, decay trauma, and write the rotational offset into `out`. */
  update(dtSeconds: number, out: ShakeOffset): void {
    this.time += dtSeconds;
    this.trauma = Math.max(0, this.trauma - SHAKE_DECAY_PER_SECOND * dtSeconds);
    const amplitude = this.trauma * this.trauma;
    const t = this.time * NOISE_RATE;
    out.pitch = amplitude * SHAKE_MAX_PITCH * shakeNoise(t, 0);
    out.yaw = amplitude * SHAKE_MAX_YAW * shakeNoise(t, 11.7);
    out.roll = amplitude * SHAKE_MAX_ROLL * shakeNoise(t, 27.3);
  }
}
