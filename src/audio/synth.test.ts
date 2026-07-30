/**
 * audio/synth.test.ts — Pure logic tests for the synthesis toolkit.
 */
import { describe, expect, it } from 'vitest';
import { detunedBase, envelopeValue, fillNoiseChannel, normalizeVolume } from './synth';

describe('envelopeValue', () => {
  const spec = { attack: 0.01, decay: 0.04, sustain: 0.3, release: 0.05, peak: 1 };

  it('starts at zero', () => {
    expect(envelopeValue(0, 0.2, spec)).toBe(0);
  });

  it('ramps to peak during attack', () => {
    expect(envelopeValue(0.005, 0.2, spec)).toBeCloseTo(0.5, 6);
    expect(envelopeValue(0.01, 0.2, spec)).toBeCloseTo(1, 6);
  });

  it('decays to sustain level', () => {
    expect(envelopeValue(0.05, 0.2, spec)).toBeCloseTo(0.3, 6);
  });

  it('holds sustain', () => {
    expect(envelopeValue(0.1, 0.2, spec)).toBeCloseTo(0.3, 6);
  });

  it('releases to zero by duration', () => {
    expect(envelopeValue(0.2, 0.2, spec)).toBe(0);
  });
});

describe('pitch helpers', () => {
  it('detunedBase applies pitch multiplier', () => {
    expect(detunedBase({}, 440)).toBe(440);
    expect(detunedBase({ pitch: 2 }, 220)).toBe(440);
  });
});

describe('normalizeVolume', () => {
  it('clamps between 0 and 1', () => {
    expect(normalizeVolume({ volume: -2 })).toBe(0);
    expect(normalizeVolume({ volume: 0.5 })).toBe(0.5);
    expect(normalizeVolume({ volume: 3 })).toBe(1);
    expect(normalizeVolume({})).toBe(1);
  });
});

describe('fillNoiseChannel', () => {
  it('produces white noise inside [-1, 1]', () => {
    const data = new Float32Array(200);
    fillNoiseChannel(data, 'white');
    for (const v of data) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('produces different colors with bounded near-zero mean', () => {
    const white = new Float32Array(1000);
    const pink = new Float32Array(1000);
    const brown = new Float32Array(1000);
    fillNoiseChannel(white, 'white');
    fillNoiseChannel(pink, 'pink');
    fillNoiseChannel(brown, 'brown');

    const mean = (d: Float32Array) => d.reduce((a, b) => a + b, 0) / d.length;
    expect(Math.abs(mean(white))).toBeLessThan(0.05);
    expect(Math.abs(mean(pink))).toBeLessThan(0.15);
    expect(Math.abs(mean(brown))).toBeLessThan(0.15);

    // All colors should be non-trivial (not pure silence).
    const nonZero = (d: Float32Array) => d.some((v) => Math.abs(v) > 0.001);
    expect(nonZero(white)).toBe(true);
    expect(nonZero(pink)).toBe(true);
    expect(nonZero(brown)).toBe(true);
  });
});
