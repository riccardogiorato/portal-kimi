/**
 * Procedural panel textures — shape, determinism, and plausible PBR channel
 * values for the Aperture material library.
 */
import { describe, expect, it } from 'vitest';
import {
  generateButtonHousing,
  generateCeiling,
  generateCubeShell,
  generateDarkMetal,
  generateFloor,
  generateGlass,
  generateTrimMetal,
  generateWallPanel,
  textureSizeFor,
} from './panelTextures';

function avgChannel(arr: Uint8ClampedArray, channel: number): number {
  let sum = 0;
  let n = 0;
  for (let i = channel; i < arr.length; i += 4) {
    sum += arr[i];
    n++;
  }
  return sum / n;
}

function allOpaque(arr: Uint8ClampedArray): boolean {
  for (let i = 3; i < arr.length; i += 4) if (arr[i] !== 255) return false;
  return true;
}

function equalArrays(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const SIZE = 64;

describe('textureSizeFor', () => {
  it('picks the hero resolution for hero surfaces, panel resolution otherwise', () => {
    expect(textureSizeFor('hero', 512, 256)).toBe(512);
    expect(textureSizeFor('panel', 512, 256)).toBe(256);
  });
});

describe('generators — shape', () => {
  it('each generator returns w*w*4 albedo/normal/MR arrays', () => {
    const cases = [
      generateWallPanel(true, SIZE, 1),
      generateWallPanel(false, SIZE, 1),
      generateFloor(SIZE, 1),
      generateCeiling(SIZE, 1),
      generateTrimMetal(SIZE, 1),
      generateDarkMetal(SIZE, 1),
      generateGlass(SIZE, 1),
      generateCubeShell(SIZE, 1),
      generateButtonHousing(SIZE, 1),
    ];
    const bytes = SIZE * SIZE * 4;
    for (const c of cases) {
      expect(c.albedo.length).toBe(bytes);
      expect(c.normal.length).toBe(bytes);
      expect(c.metallicRoughness.length).toBe(bytes);
      expect(allOpaque(c.albedo)).toBe(true);
      expect(allOpaque(c.normal)).toBe(true);
    }
  });

  it('button housing exposes an emissive ring mask', () => {
    const c = generateButtonHousing(SIZE, 1);
    expect(c.emissive).toBeDefined();
    expect(c.emissive!.length).toBe(SIZE * SIZE * 4);
    // The ring is bright: at least some emissive pixels are well above mid.
    expect(avgChannel(c.emissive!, 0)).toBeGreaterThan(10);
  });
});

describe('generators — determinism', () => {
  it('same seed -> byte-identical output', () => {
    const a = generateWallPanel(true, SIZE, 4242);
    const b = generateWallPanel(true, SIZE, 4242);
    expect(equalArrays(a.albedo, b.albedo)).toBe(true);
    expect(equalArrays(a.normal, b.normal)).toBe(true);
    expect(equalArrays(a.metallicRoughness, b.metallicRoughness)).toBe(true);
  });

  it('different seeds -> different output', () => {
    const a = generateWallPanel(true, SIZE, 1);
    const b = generateWallPanel(true, SIZE, 2);
    expect(equalArrays(a.albedo, b.albedo)).toBe(false);
  });
});

describe('generators — plausible PBR values', () => {
  it('white wall is brighter than dark gunmetal wall', () => {
    const white = generateWallPanel(true, SIZE, 1);
    const dark = generateWallPanel(false, SIZE, 1);
    expect(avgChannel(white.albedo, 0)).toBeGreaterThan(avgChannel(dark.albedo, 0) + 80);
  });

  it('dark gunmetal wall is metallic; white wall is not', () => {
    const white = generateWallPanel(true, SIZE, 1);
    const dark = generateWallPanel(false, SIZE, 1);
    // B channel = metallic. Dark wall ~0.85 metallic, white ~0.
    expect(avgChannel(dark.metallicRoughness, 2)).toBeGreaterThan(180);
    expect(avgChannel(white.metallicRoughness, 2)).toBeLessThan(20);
  });

  it('glass is low-roughness (smooth)', () => {
    const glass = generateGlass(SIZE, 1);
    // G channel = roughness; glass ~0.06 -> ~15/255.
    expect(avgChannel(glass.metallicRoughness, 1)).toBeLessThan(45);
  });

  it('trim metal is fully metallic', () => {
    const trim = generateTrimMetal(SIZE, 1);
    expect(avgChannel(trim.metallicRoughness, 2)).toBeGreaterThan(240);
  });
});