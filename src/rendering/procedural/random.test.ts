/**
 * Deterministic pseudo-random sources — range, determinism, smoothness.
 */
import { describe, expect, it } from 'vitest';
import { fbm2, hash2i, mulberry32, valueNoise2 } from './random';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 8; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces values in [0, 1)', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('hash2i', () => {
  it('produces values in [0, 1)', () => {
    for (let x = -5; x < 5; x++) {
      for (let y = -5; y < 5; y++) {
        const v = hash2i(x, y, 7);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('is deterministic', () => {
    expect(hash2i(3, 4, 5)).toBe(hash2i(3, 4, 5));
  });
});

describe('valueNoise2', () => {
  it('stays in [0, 1]', () => {
    for (let i = 0; i < 200; i++) {
      const v = valueNoise2(i * 0.13, i * 0.27, 11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('matches the lattice hash at integer coordinates', () => {
    expect(valueNoise2(2, 3, 11)).toBe(hash2i(2, 3, 11));
  });
});

describe('fbm2', () => {
  it('stays in [0, 1]', () => {
    for (let i = 0; i < 200; i++) {
      const v = fbm2(i * 0.07, i * 0.19, 4, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    expect(fbm2(1.5, 2.5, 3, 9)).toBe(fbm2(1.5, 2.5, 3, 9));
  });
});