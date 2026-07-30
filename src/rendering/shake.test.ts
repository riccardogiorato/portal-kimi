/**
 * shake.test.ts — Trauma-based screen shake (pure math). The decay curve must
 * be deterministic, trauma clamps at 1, and the rotational offset stays within
 * the configured max amplitudes and settles to zero.
 */
import { describe, expect, it } from 'vitest';
import {
  applyShakeAdditive,
  SHAKE_DECAY_PER_SECOND,
  SHAKE_MAX_PITCH,
  SHAKE_MAX_ROLL,
  SHAKE_MAX_YAW,
  ScreenShake,
  shakeNoise,
} from './shake';
import type { ShakeOffset } from './shake';

describe('shakeNoise', () => {
  it('stays in [-1, 1] across a range of times and seeds', () => {
    for (let t = 0; t < 50; t += 0.37) {
      for (const seed of [0, 11.7, 27.3]) {
        const v = shakeNoise(t, seed);
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('ScreenShake', () => {
  const out = (): ShakeOffset => ({ pitch: 0, yaw: 0, roll: 0 });

  it('clamps accumulated trauma to 1', () => {
    const s = new ScreenShake();
    s.add(0.5);
    expect(s.currentTrauma).toBeCloseTo(0.5, 5);
    s.add(0.6);
    expect(s.currentTrauma).toBe(1);
  });

  it('ignores non-positive / non-finite impulses', () => {
    const s = new ScreenShake();
    s.add(-1);
    s.add(0);
    s.add(Number.NaN);
    expect(s.currentTrauma).toBe(0);
  });

  it('decays trauma linearly over time (deterministic curve)', () => {
    const s = new ScreenShake();
    s.add(1);
    expect(s.currentTrauma).toBe(1);
    s.update(0.5, out());
    // 1 - 1.6 * 0.5 = 0.2
    expect(s.currentTrauma).toBeCloseTo(0.2, 5);
    s.update(0.5, out());
    // 0.2 - 1.6 * 0.5 = 0 (clamped)
    expect(s.currentTrauma).toBe(0);
  });

  it('bounds the offset to the configured max amplitudes', () => {
    const s = new ScreenShake();
    const o = out();
    s.add(1);
    for (let i = 0; i < 20; i++) {
      s.update(0.0001, o); // keep trauma ~1 while sweeping noise phases
      expect(Math.abs(o.pitch)).toBeLessThanOrEqual(SHAKE_MAX_PITCH + 1e-9);
      expect(Math.abs(o.yaw)).toBeLessThanOrEqual(SHAKE_MAX_YAW + 1e-9);
      expect(Math.abs(o.roll)).toBeLessThanOrEqual(SHAKE_MAX_ROLL + 1e-9);
    }
  });

  it('settles to a zero offset once trauma has decayed', () => {
    const s = new ScreenShake();
    const o = out();
    s.add(1);
    s.update(2 / SHAKE_DECAY_PER_SECOND, o); // well past full decay
    expect(s.currentTrauma).toBe(0);
    expect(o.pitch).toBe(0);
    expect(o.yaw).toBe(0);
    expect(o.roll).toBe(0);
  });

  it('reset clears trauma', () => {
    const s = new ScreenShake();
    s.add(1);
    s.reset();
    expect(s.currentTrauma).toBe(0);
  });
});

describe('applyShakeAdditive', () => {
  // The player controller writes a fresh unshaken base rotation every frame
  // (before rendering.update). Rendering therefore ONLY ADDS the current frame's
  // shake offset and never subtracts a previous one — the player's next write
  // discards last frame's offset, so subtraction would invert/accumulate it.

  it('adds the offset to a rotation in place', () => {
    const r = { x: 0.1, y: 0.2, z: 0.3 };
    applyShakeAdditive(r, { pitch: 0.01, yaw: -0.02, roll: 0.03 });
    expect(r.x).toBeCloseTo(0.11, 9);
    expect(r.y).toBeCloseTo(0.18, 9);
    expect(r.z).toBeCloseTo(0.33, 9);
  });

  it('does not accumulate across frames when the player rewrites the base', () => {
    const base = { x: 0.1, y: 0.2, z: 0.3 }; // unshaken base the player writes each frame
    const offset: ShakeOffset = { pitch: 0.01, yaw: -0.02, roll: 0.03 };
    let drifted = false;
    for (let frame = 0; frame < 100; frame++) {
      // Player writes a fresh base every frame, then rendering adds the offset.
      const cam = { ...base };
      applyShakeAdditive(cam, offset);
      // The shaken rotation must be exactly base + offset every frame — no drift.
      if (cam.x !== base.x + offset.pitch || cam.y !== base.y + offset.yaw || cam.z !== base.z + offset.roll) {
        drifted = true;
        break;
      }
    }
    expect(drifted).toBe(false);
  });

  it('would drift if the base were NOT reset (guards the contract)', () => {
    // This documents WHY add-only is correct only with a per-frame base reset:
    // re-adding to an un-reset rotation accumulates. The player prevents this.
    const cam = { x: 0, y: 0, z: 0 };
    const offset: ShakeOffset = { pitch: 0.01, yaw: 0, roll: 0 };
    for (let frame = 0; frame < 5; frame++) applyShakeAdditive(cam, offset);
    expect(cam.x).toBeCloseTo(0.05, 9); // accumulated — the case the contract avoids
  });
});