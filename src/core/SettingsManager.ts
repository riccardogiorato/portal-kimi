/**
 * core/SettingsManager.ts — Player settings with localStorage persistence.
 * Emits 'settings:changed' so audio/rendering/player react live.
 */
import type { EventBus } from './EventBus';
import type { GameSettings } from './types';

const STORAGE_KEY = 'portal-kimi:settings:v1';

export const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 0.9,
  musicVolume: 0.7,
  sfxVolume: 1.0,
  mouseSensitivity: 1.0,
  invertY: false,
  fovDegrees: 75,
  quality: 'high',
  subtitles: true,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function sanitize(raw: Partial<GameSettings>): GameSettings {
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  merged.masterVolume = clamp01(merged.masterVolume);
  merged.musicVolume = clamp01(merged.musicVolume);
  merged.sfxVolume = clamp01(merged.sfxVolume);
  merged.mouseSensitivity = Math.min(10, Math.max(0.1, merged.mouseSensitivity));
  merged.fovDegrees = Math.min(120, Math.max(60, merged.fovDegrees));
  if (!['low', 'medium', 'high', 'ultra'].includes(merged.quality)) merged.quality = 'high';
  merged.invertY = Boolean(merged.invertY);
  merged.subtitles = Boolean(merged.subtitles);
  return merged;
}

export class SettingsManager {
  private current: GameSettings;

  constructor(private readonly events: EventBus) {
    this.current = this.load();
  }

  get settings(): Readonly<GameSettings> {
    return this.current;
  }

  update(patch: Partial<GameSettings>): void {
    const next = sanitize({ ...this.current, ...patch });
    const changed = (Object.keys(next) as (keyof GameSettings)[]).some(
      (key) => next[key] !== this.current[key],
    );
    if (!changed) return;
    this.current = next;
    this.persist();
    this.events.emit('settings:changed', { settings: { ...next } });
  }

  private load(): GameSettings {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return sanitize(JSON.parse(raw) as Partial<GameSettings>);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private persist(): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.current));
    } catch {
      // Private browsing / quota: settings simply won't persist.
    }
  }
}
