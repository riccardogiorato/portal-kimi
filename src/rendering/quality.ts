/**
 * rendering/quality.ts — Quality-tier mapping. Translates a QualityLevel plus
 * the numbers in CONFIG.rendering into one immutable settings bundle consumed
 * by lighting, post-processing and ambience. Pure: unit-tested, no Babylon.
 */
import { qualityRank, type GameConfig } from '../core/Config';
import type { QualityLevel } from '../core/types';

export interface QualitySettings {
  readonly level: QualityLevel;
  /** Shadow map resolution for the key light; 0 disables shadows. */
  readonly shadowMapSize: number;
  /** MSAA sample count on the default pipeline (1 = off). */
  readonly msaaSamples: number;
  /** SSAO2 enabled (high/ultra only — it costs a geometry prepass). */
  readonly ssao: boolean;
  readonly ssaoSamples: number;
  /** SSAO render ratio relative to full res. */
  readonly ssaoRatio: number;
  /** Dust-mote particle capacity; 0 disables the system. */
  readonly dustCapacity: number;
  /** Budget of fake volumetric light shafts a chamber may request. */
  readonly maxLightShafts: number;
  /** Resolution of the 2m panel textures (~128px/m at 256). */
  readonly panelTextureSize: number;
  /** Resolution of hero surfaces (cube shell, button housing). */
  readonly heroTextureSize: number;
  readonly bloomEnabled: boolean;
  readonly grainEnabled: boolean;
  readonly chromaticAberrationEnabled: boolean;
}

type RenderingConfig = GameConfig['rendering'];

const SSAO_SAMPLES: Record<QualityLevel, number> = { low: 0, medium: 0, high: 16, ultra: 32 };
const DUST_CAPACITY: Record<QualityLevel, number> = { low: 0, medium: 120, high: 260, ultra: 420 };
const LIGHT_SHAFT_BUDGET: Record<QualityLevel, number> = { low: 4, medium: 8, high: 12, ultra: 16 };
const PANEL_TEXTURE_SIZE: Record<QualityLevel, number> = { low: 128, medium: 256, high: 256, ultra: 256 };
const HERO_TEXTURE_SIZE: Record<QualityLevel, number> = { low: 256, medium: 256, high: 512, ultra: 512 };

export function qualitySettingsFor(level: QualityLevel, rendering: RenderingConfig): QualitySettings {
  const rank = qualityRank(level);
  return {
    level,
    shadowMapSize: rendering.shadowMapSize[level],
    msaaSamples: rendering.msaaSamples[level],
    ssao: rank >= qualityRank('high'),
    ssaoSamples: SSAO_SAMPLES[level],
    ssaoRatio: 0.5,
    dustCapacity: DUST_CAPACITY[level],
    maxLightShafts: LIGHT_SHAFT_BUDGET[level],
    panelTextureSize: PANEL_TEXTURE_SIZE[level],
    heroTextureSize: HERO_TEXTURE_SIZE[level],
    // Bloom + grain define the Aperture look and are cheap; keep them on all
    // tiers. Chromatic aberration costs an extra pass — medium and up.
    bloomEnabled: true,
    grainEnabled: true,
    chromaticAberrationEnabled: rank >= qualityRank('medium'),
  };
}
