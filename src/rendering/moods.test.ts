/**
 * Chamber moods — target bundles, deep-clone independence, damped lerp toward
 * a target, and the deterministic fluorescent flicker driver.
 */
import { describe, expect, it } from 'vitest';
import { MOOD_TARGETS, cloneMood, dampMoodInPlace, flickerMultiplier } from './moods';

describe('MOOD_TARGETS', () => {
  it('defines clean / damaged / dark bundles', () => {
    for (const m of ['clean', 'damaged', 'dark'] as const) {
      expect(MOOD_TARGETS[m]).toBeDefined();
      expect(MOOD_TARGETS[m].keyIntensity).toBeGreaterThan(0);
    }
  });

  it('dark mood is dimmer than clean', () => {
    expect(MOOD_TARGETS.dark.keyIntensity).toBeLessThan(MOOD_TARGETS.clean.keyIntensity);
  });

  it('only damaged mood carries flicker', () => {
    expect(MOOD_TARGETS.clean.flicker).toBe(0);
    expect(MOOD_TARGETS.dark.flicker).toBe(0);
    expect(MOOD_TARGETS.damaged.flicker).toBeGreaterThan(0);
  });
});

describe('cloneMood', () => {
  it('is a deep copy — mutating the clone never touches the const', () => {
    const original = MOOD_TARGETS.clean.keyColor.r;
    const clone = cloneMood(MOOD_TARGETS.clean);
    clone.keyColor.r = 0.123;
    clone.keyIntensity = 9;
    expect(MOOD_TARGETS.clean.keyColor.r).toBe(original);
    expect(MOOD_TARGETS.clean.keyIntensity).not.toBe(9);
  });
});

describe('dampMoodInPlace', () => {
  it('moves the live bundle toward the target and converges', () => {
    const live = cloneMood(MOOD_TARGETS.clean);
    const target = MOOD_TARGETS.dark;
    // First step moves partway (between clean and dark) without overshooting past.
    dampMoodInPlace(live, target, 3, 0.1);
    expect(live.keyIntensity).toBeLessThan(MOOD_TARGETS.clean.keyIntensity);
    expect(live.keyIntensity).toBeGreaterThan(target.keyIntensity);
    // Many steps converge to the target.
    for (let i = 0; i < 600; i++) dampMoodInPlace(live, target, 4, 0.05);
    expect(Math.abs(live.keyIntensity - target.keyIntensity)).toBeLessThan(1e-3);
  });

  it('is a no-op when live already equals target', () => {
    const live = cloneMood(MOOD_TARGETS.damaged);
    const before = live.hemiSky.g;
    dampMoodInPlace(live, MOOD_TARGETS.damaged, 3, 0.1);
    expect(live.hemiSky.g).toBe(before);
  });
});

describe('flickerMultiplier', () => {
  it('is 1 with no flicker amount', () => {
    for (let t = 0; t < 5; t += 0.07) {
      expect(flickerMultiplier(t, 0)).toBe(1);
    }
  });

  it('stays in [1 - amount, 1] for the damaged amount', () => {
    const amount = MOOD_TARGETS.damaged.flicker;
    for (let i = 0; i < 500; i++) {
      const v = flickerMultiplier(i * 0.017, amount);
      expect(v).toBeGreaterThanOrEqual(1 - amount);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic (same time -> same value)', () => {
    expect(flickerMultiplier(3.3, 0.4)).toBe(flickerMultiplier(3.3, 0.4));
  });
});