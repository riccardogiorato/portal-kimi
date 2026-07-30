import type { GameSettings, QualityLevel } from '../core/types';

const QUALITY_LEVELS = new Set<QualityLevel>(['low', 'medium', 'high', 'ultra']);

const NUMERIC_SETTINGS = new Set<keyof GameSettings>([
  'masterVolume',
  'musicVolume',
  'sfxVolume',
  'mouseSensitivity',
  'fovDegrees',
]);

const BOOLEAN_SETTINGS = new Set<keyof GameSettings>(['invertY', 'subtitles']);

/** Converts a raw input value into the typed patch expected by SettingsManager. */
export function buildSettingsPatch(field: keyof GameSettings, raw: string): Partial<GameSettings> {
  if (NUMERIC_SETTINGS.has(field)) {
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return {};
    return { [field]: n } as Partial<GameSettings>;
  }

  if (BOOLEAN_SETTINGS.has(field)) {
    return { [field]: raw === 'true' } as Partial<GameSettings>;
  }

  if (field === 'quality') {
    if (!QUALITY_LEVELS.has(raw as QualityLevel)) return {};
    return { quality: raw as GameSettings['quality'] };
  }

  return {};
}

/** Clamp helpers for controls that want immediate visual feedback before sanitization. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
