import { describe, it, expect } from 'vitest';
import { buildSettingsPatch, clamp } from './SettingsBinding';

describe('buildSettingsPatch', () => {
  it('parses volume sliders', () => {
    expect(buildSettingsPatch('masterVolume', '0.5')).toEqual({ masterVolume: 0.5 });
    expect(buildSettingsPatch('musicVolume', '0')).toEqual({ musicVolume: 0 });
    expect(buildSettingsPatch('sfxVolume', '1')).toEqual({ sfxVolume: 1 });
  });

  it('parses numeric tuning values', () => {
    expect(buildSettingsPatch('mouseSensitivity', '3.5')).toEqual({ mouseSensitivity: 3.5 });
    expect(buildSettingsPatch('fovDegrees', '90')).toEqual({ fovDegrees: 90 });
  });

  it('parses booleans from stringified values', () => {
    expect(buildSettingsPatch('invertY', 'true')).toEqual({ invertY: true });
    expect(buildSettingsPatch('subtitles', 'false')).toEqual({ subtitles: false });
  });

  it('passes quality through as a string', () => {
    expect(buildSettingsPatch('quality', 'high')).toEqual({ quality: 'high' });
  });

  it('returns an empty patch for unexpected quality values', () => {
    expect(buildSettingsPatch('quality', 'potato')).toEqual({});
    expect(buildSettingsPatch('quality', '')).toEqual({});
  });

  it('returns an empty patch for non-finite numbers', () => {
    expect(buildSettingsPatch('masterVolume', 'abc')).toEqual({});
  });
});

describe('clamp', () => {
  it('pins values inside a range', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});
