/**
 * quality.test.ts — Quality-tier mapping (pure). Every tier must resolve to a
 * sensible bundle of shadow/MSAA/SSAO/dust/shaft/texture flags driven by
 * CONFIG.rendering, so a settings change never leaks or surprises the look.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../core/Config';
import { qualitySettingsFor } from './quality';

const R = CONFIG.rendering;

describe('qualitySettingsFor', () => {
  it('maps shadow map size per tier (0 = off on low)', () => {
    expect(qualitySettingsFor('low', R).shadowMapSize).toBe(R.shadowMapSize.low);
    expect(qualitySettingsFor('medium', R).shadowMapSize).toBe(R.shadowMapSize.medium);
    expect(qualitySettingsFor('high', R).shadowMapSize).toBe(R.shadowMapSize.high);
    expect(qualitySettingsFor('ultra', R).shadowMapSize).toBe(R.shadowMapSize.ultra);
    expect(R.shadowMapSize.low).toBe(0); // shadows off on the lowest tier
  });

  it('maps MSAA sample count per tier', () => {
    expect(qualitySettingsFor('low', R).msaaSamples).toBe(R.msaaSamples.low);
    expect(qualitySettingsFor('high', R).msaaSamples).toBe(R.msaaSamples.high);
  });

  it('enables SSAO2 only at high/ultra with quality-scaled samples', () => {
    expect(qualitySettingsFor('low', R).ssao).toBe(false);
    expect(qualitySettingsFor('medium', R).ssao).toBe(false);
    expect(qualitySettingsFor('high', R).ssao).toBe(true);
    expect(qualitySettingsFor('ultra', R).ssao).toBe(true);
    expect(qualitySettingsFor('high', R).ssaoSamples).toBeLessThan(qualitySettingsFor('ultra', R).ssaoSamples);
  });

  it('scales dust capacity and light-shaft budget with tier', () => {
    const tiers = ['low', 'medium', 'high', 'ultra'] as const;
    let prevDust = -1;
    for (const t of tiers) {
      const d = qualitySettingsFor(t, R).dustCapacity;
      expect(d).toBeGreaterThanOrEqual(prevDust);
      prevDust = d;
    }
    expect(qualitySettingsFor('low', R).dustCapacity).toBe(0); // dust off on low
    expect(qualitySettingsFor('ultra', R).maxLightShafts).toBeGreaterThan(qualitySettingsFor('low', R).maxLightShafts);
  });

  it('keeps panel texel density constant and reserves higher res for hero surfaces', () => {
    const high = qualitySettingsFor('high', R);
    expect(high.panelTextureSize).toBe(high.heroTextureSize === 512 ? 256 : high.heroTextureSize);
    // Hero surfaces (cube shell, button housing) get at least as many texels as panels.
    expect(high.heroTextureSize).toBeGreaterThanOrEqual(high.panelTextureSize);
  });

  it('keeps bloom + grain on every tier and gates chromatic aberration to medium+', () => {
    for (const t of ['low', 'medium', 'high', 'ultra'] as const) {
      const s = qualitySettingsFor(t, R);
      expect(s.bloomEnabled).toBe(true);
      expect(s.grainEnabled).toBe(true);
    }
    expect(qualitySettingsFor('low', R).chromaticAberrationEnabled).toBe(false);
    expect(qualitySettingsFor('medium', R).chromaticAberrationEnabled).toBe(true);
  });

  it('records the level on the resolved settings', () => {
    expect(qualitySettingsFor('ultra', R).level).toBe('ultra');
  });
});