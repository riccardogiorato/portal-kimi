/**
 * rendering/materials.ts — Procedural PBR material library (IMaterialLibrary).
 *
 * Builds one shared PBRMaterial per surface class from the pure texture
 * generators in procedural/panelTextures.ts, uploads them as RawTextures (no
 * canvas, no network) and wires Babylon's metallic-roughness-AO packed channel
 * convention. Materials are shared instances — consumers cache and reuse the
 * returned Material and never mutate it.
 *
 * setQuality() re-tiers procedural texture resolution in place: when the
 * resolved panel/hero texel sizes change it regenerates the maps and SWAPS the
 * textures on the existing PBRMaterial instances (disposing the old ones), so
 * consumers' cached Material references stay valid while the surface detail
 * tracks the quality setting. Everything created here is disposed in dispose().
 */
import { Color3, Constants, Material, PBRMaterial, RawTexture } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import type { IMaterialLibrary } from '../core/types';
import {
  generateButtonHousing,
  generateCeiling,
  generateCubeShell,
  generateDarkMetal,
  generateFloor,
  generateGlass,
  generateTrimMetal,
  generateWallPanel,
  type GeneratedMaps,
} from './procedural/panelTextures';

/** Deterministic per-surface seeds so textures are byte-identical run-to-run. */
const SEED = {
  wallWhite: 0x57a1,
  wallDark: 0x1b7e,
  floor: 0x39c4,
  ceiling: 0x72d0,
  trim: 0x4aa5,
  darkMetal: 0x6f11,
  glass: 0x8e22,
  cube: 0x1357,
  button: 0xb00b,
} as const;

interface SurfaceOptions {
  doubleSided?: boolean;
  glass?: boolean;
}

/** Describes one shared surface material so build() and setQuality() share code. */
interface SurfaceSpec {
  key: string;
  name: string;
  hero: boolean;
  glass?: boolean;
  maps: (size: number) => GeneratedMaps;
}

export class MaterialLibrary implements IMaterialLibrary {
  private readonly cache = new Map<string, Material>();
  private readonly emissiveCache = new Map<string, Material>();
  /** Textures owned by each surface PBRMaterial (for in-place swap disposal). */
  private readonly matTextures = new Map<PBRMaterial, RawTexture[]>();
  private readonly built: Material[] = [];
  /** Current resolved texture sizes (mutable; updated by setQuality). */
  private panelSize: number;
  private heroSize: number;

  constructor(
    private readonly scene: Scene,
    panelSize: number,
    heroSize: number,
  ) {
    this.panelSize = panelSize;
    this.heroSize = heroSize;
  }

  /** Build every shared surface material up front (one-time, at init). */
  build(): void {
    for (const spec of this.surfaceSpecs()) {
      if (spec.key === 'glass') continue; // glass is built lazily on first request
      const mat = new PBRMaterial(spec.name, this.scene);
      this.built.push(mat);
      this.cache.set(spec.key, mat);
      this.applyMaps(mat, spec.maps(this.sizeFor(spec)), spec.glass ? { glass: true } : {});
    }
  }

  /**
   * Re-tier procedural texture resolution in place. When the resolved panel/
   * hero sizes change, regenerate the maps and SWAP the textures on the
   * existing PBRMaterial instances (disposing the old ones). No new Material
   * instances are created, so consumers' cached references stay valid. Emissive
   * materials have no textures and are left untouched. No-op if unchanged.
   */
  setQuality(panelSize: number, heroSize: number): void {
    if (panelSize === this.panelSize && heroSize === this.heroSize) return;
    this.panelSize = panelSize;
    this.heroSize = heroSize;
    for (const spec of this.surfaceSpecs()) {
      const mat = this.cache.get(spec.key);
      if (!mat) continue; // not built yet (e.g. glass before first request)
      this.applyMaps(mat as PBRMaterial, spec.maps(this.sizeFor(spec)), spec.glass ? { glass: true } : {});
    }
  }

  // --- IMaterialLibrary ---------------------------------------------------

  wallPanel(portalable: boolean): Material {
    return this.require(this.cache, portalable ? 'wall-white' : 'wall-dark');
  }
  floorPanel(): Material {
    return this.require(this.cache, 'floor');
  }
  ceilingPanel(): Material {
    return this.require(this.cache, 'ceiling');
  }
  trimMetal(): Material {
    return this.require(this.cache, 'trim');
  }
  darkMetal(): Material {
    return this.require(this.cache, 'dark-metal');
  }
  cubeShell(): Material {
    return this.require(this.cache, 'cube');
  }
  buttonHousing(): Material {
    return this.require(this.cache, 'button');
  }
  glass(): Material {
    let mat = this.cache.get('glass');
    if (!mat) {
      const pbr = new PBRMaterial('mat-glass', this.scene);
      this.built.push(pbr);
      this.cache.set('glass', pbr);
      this.applyMaps(pbr, generateGlass(this.panelSize, SEED.glass), { glass: true });
      mat = pbr;
    }
    return mat;
  }
  emissive(color: Color3, intensity?: number): Material {
    const i = intensity ?? 1;
    const key = `${round(color.r)}_${round(color.g)}_${round(color.b)}_${round(i)}`;
    let mat = this.emissiveCache.get(key);
    if (mat) return mat;
    const pbr = new PBRMaterial(`mat-emissive-${this.emissiveCache.size}`, this.scene);
    // Self-illuminated strip/indicator: emissive drives the look, albedo matches
    // so the surface still reads as that color when the strip is off-screen lit.
    pbr.emissiveColor = color.clone();
    pbr.emissiveIntensity = i;
    pbr.albedoColor = color.clone().scale(0.18);
    pbr.metallic = 0;
    pbr.roughness = 0.6;
    pbr.ambientColor = Color3.White(); // see applyMaps note: Babylon 9 defaults this to black
    this.built.push(pbr);
    this.emissiveCache.set(key, pbr);
    return pbr;
  }

  // --- Internals ----------------------------------------------------------

  /** The full list of shared surface specs (build + re-tier share this). */
  private surfaceSpecs(): SurfaceSpec[] {
    return [
      { key: 'wall-white', name: 'mat-wall-white', hero: false, maps: (s) => generateWallPanel(true, s, SEED.wallWhite) },
      { key: 'wall-dark', name: 'mat-wall-dark', hero: false, maps: (s) => generateWallPanel(false, s, SEED.wallDark) },
      { key: 'floor', name: 'mat-floor', hero: false, maps: (s) => generateFloor(s, SEED.floor) },
      { key: 'ceiling', name: 'mat-ceiling', hero: false, maps: (s) => generateCeiling(s, SEED.ceiling) },
      { key: 'trim', name: 'mat-trim', hero: false, maps: (s) => generateTrimMetal(s, SEED.trim) },
      { key: 'dark-metal', name: 'mat-dark-metal', hero: false, maps: (s) => generateDarkMetal(s, SEED.darkMetal) },
      { key: 'cube', name: 'mat-cube', hero: true, maps: (s) => generateCubeShell(s, SEED.cube) },
      { key: 'button', name: 'mat-button', hero: true, maps: (s) => generateButtonHousing(s, SEED.button) },
      { key: 'glass', name: 'mat-glass', hero: false, glass: true, maps: (s) => generateGlass(s, SEED.glass) },
    ];
  }

  private sizeFor(spec: SurfaceSpec): number {
    return spec.hero ? this.heroSize : this.panelSize;
  }

  /**
   * (Re)generate + attach the albedo/normal/ORM (and optional emissive) maps to
   * an existing PBRMaterial, disposing any textures it previously owned. Used
   * by both build() (fresh materials) and setQuality() (in-place re-tiers).
   */
  private applyMaps(mat: PBRMaterial, maps: GeneratedMaps, opts: SurfaceOptions): void {
    const old = this.matTextures.get(mat);
    if (old) {
      for (const tex of old) tex.dispose();
      this.matTextures.delete(mat);
    }
    const created: RawTexture[] = [];
    mat.albedoTexture = this.uploadRGB(maps.albedo, maps.size, true, created);
    mat.bumpTexture = this.uploadRGB(maps.normal, maps.size, false, created); // tangent-space normal
    // Packed metallic-roughness-AO: R=AO, G=roughness, B=metallic.
    mat.metallicTexture = this.uploadRGB(maps.metallicRoughness, maps.size, false, created);
    mat.useAmbientOcclusionFromMetallicTextureRed = true;
    mat.useRoughnessFromMetallicTextureGreen = true;
    mat.useMetallnessFromMetallicTextureBlue = true;
    mat.metallic = 1; // texture B channel drives metalness
    mat.roughness = 1; // texture G channel drives roughness
    mat.albedoColor = Color3.White();
    // Babylon 9 defaults PBR ambientColor to BLACK, which multiplies away ALL
    // ambient light (hemispheric fill + IBL) — surfaces facing away from the
    // key light render pitch black. White restores the full ambient response.
    mat.ambientColor = Color3.White();
    if (maps.emissive) {
      mat.emissiveTexture = this.uploadRGB(maps.emissive, maps.size, true, created);
      mat.emissiveColor = Color3.White();
      mat.emissiveIntensity = 1;
    }
    if (opts.glass) {
      mat.alpha = 0.32;
      mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
      mat.backFaceCulling = false; // visible from both sides of a pane
    }
    if (opts.doubleSided) {
      mat.backFaceCulling = false;
    }
    this.matTextures.set(mat, created);
  }

  /** Upload an RGBA byte buffer as a tiling, mip-mipped RawTexture. */
  private uploadRGB(data: Uint8ClampedArray, size: number, srgb: boolean, into: RawTexture[]): RawTexture {
    const tex = RawTexture.CreateRGBATexture(
      data,
      size,
      size,
      this.scene,
      true, // generateMipMaps (trilinear at distance)
      false, // invertY: keep generated pixel layout consistent across all maps
      Constants.TEXTURE_TRILINEAR_SAMPLINGMODE,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
      0, // creationFlags
      srgb, // useSRGBBuffer for albedo/emissive; linear for normal/MR
    );
    tex.wrapU = Constants.TEXTURE_WRAP_ADDRESSMODE;
    tex.wrapV = Constants.TEXTURE_WRAP_ADDRESSMODE;
    into.push(tex);
    return tex;
  }

  private require(cache: Map<string, Material>, key: string): Material {
    const mat = cache.get(key);
    if (!mat) throw new Error(`MaterialLibrary: "${key}" not built (was build() called?)`);
    return mat;
  }

  dispose(): void {
    // Free textures first, then materials. Emissive materials own no textures
    // (they are absent from matTextures) — only surface materials do.
    for (const list of this.matTextures.values()) {
      for (const tex of list) tex.dispose();
    }
    this.matTextures.clear();
    for (const mat of this.built) mat.dispose();
    this.built.length = 0;
    this.cache.clear();
    this.emissiveCache.clear();
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}