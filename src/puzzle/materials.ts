/**
 * puzzle/materials.ts — Procedural materials owned by the puzzle subsystem.
 */
import { Color3, DynamicTexture, StandardMaterial } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import type { IGameContext } from '../core/types';

const ORANGE_ACCENT = new Color3(1, 0.45, 0.08);
const CYAN_ACCENT = new Color3(0.12, 0.72, 1);
const LASER_RED = new Color3(1, 0.05, 0.05);
const GOO_DARK = new Color3(0.05, 0.25, 0.05);

export class PuzzleMaterials {
  readonly scene: Scene;
  readonly orangeEmissive: StandardMaterial;
  readonly cyanEmissive: StandardMaterial;
  readonly laserBeam: StandardMaterial;
  readonly bridgeEnergy: StandardMaterial;
  readonly funnelEnergy: StandardMaterial;
  readonly gooSurface: StandardMaterial;

  private readonly ownedMaterials: StandardMaterial[] = [];
  private readonly ownedTextures: DynamicTexture[] = [];

  constructor(ctx: IGameContext) {
    this.scene = ctx.scene;

    this.orangeEmissive = this.makeEmissive('puzzle-orange', ORANGE_ACCENT);
    this.cyanEmissive = this.makeEmissive('puzzle-cyan', CYAN_ACCENT);
    this.laserBeam = this.makeEmissive('puzzle-laser', LASER_RED, 0.75);
    this.bridgeEnergy = this.makeScrollable('puzzle-bridge', CYAN_ACCENT);
    this.funnelEnergy = this.makeScrollable('puzzle-funnel', CYAN_ACCENT);
    this.gooSurface = this.makeGoo('puzzle-goo');
  }

  private makeEmissive(name: string, color: Color3, alpha = 1): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = color;
    m.alpha = alpha;
    if (alpha < 1) {
      m.alphaMode = 1; // ALPHA_ADD from Material constants
    }
    this.ownedMaterials.push(m);
    return m;
  }

  private makeScrollable(name: string, color: Color3): StandardMaterial {
    const size = 128;
    const texture = new DynamicTexture(name + '-tex', size, this.scene);
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    const cr = Math.floor(color.r * 255);
    const cg = Math.floor(color.g * 255);
    const cb = Math.floor(color.b * 255);
    // Soft translucent body so the column reads as a volume…
    ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.16)`;
    ctx.fillRect(0, 0, size, size);
    // …plus dense flow lines so the energy current is visible (additive
    // blending washed these out to nothing over bright backgrounds).
    for (let i = 0; i <= size; i += 8) {
      const strong = i % 32 === 0;
      ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${strong ? 0.75 : 0.35})`;
      ctx.lineWidth = strong ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }
    texture.update();
    texture.wrapU = 1; // Texture.WRAP_ADDRESSMODE
    texture.wrapV = 1;
    texture.hasAlpha = true;
    this.ownedTextures.push(texture);

    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = color.scale(1.5);
    m.emissiveTexture = texture;
    m.opacityTexture = texture;
    m.alpha = 0.85;
    m.alphaMode = 0; // ALPHA_COMBINE — visible over bright chambers
    this.ownedMaterials.push(m);
    return m;
  }

  private makeGoo(name: string): StandardMaterial {
    const size = 128;
    const texture = new DynamicTexture(name + '-tex', size, this.scene);
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    for (let y = 0; y < size; y += 4) {
      for (let x = 0; x < size; x += 4) {
        const noise = Math.random();
        // Murky toxic liquid: dark swampy greens, not neon (Portal 2's goo is
        // a murk with a subtle sickly shimmer, not a glow pool).
        const r = 12 + Math.floor(noise * 30);
        const g = 22 + Math.floor(noise * 62);
        const b = 12 + Math.floor(noise * 26);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
        ctx.fillRect(x, y, 4, 4);
      }
    }
    texture.update();
    texture.wrapU = 1;
    texture.wrapV = 1;
    this.ownedTextures.push(texture);

    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = GOO_DARK;
    m.emissiveColor = new Color3(0.04, 0.22, 0.05);
    m.emissiveTexture = texture;
    m.specularColor = Color3.White();
    m.specularPower = 32;
    // Opaque deadly pool: additive blending washed out to invisibility over
    // the bright floor, so the pit read as solid ground (lethal surprise).
    m.alpha = 1;
    m.alphaMode = 0; // ALPHA_COMBINE — standard blending, fully opaque
    this.ownedMaterials.push(m);
    return m;
  }

  /** Adjust the texture offset for scrolling effects without allocations. */
  scrollTexture(material: StandardMaterial, uOffset: number, vOffset: number): void {
    const texture = material.emissiveTexture as DynamicTexture | null;
    if (texture) {
      texture.uOffset = uOffset;
      texture.vOffset = vOffset;
    }
  }

  dispose(): void {
    for (const m of this.ownedMaterials) {
      m.dispose(false, false); // keep textures alive so we can dispose them below
    }
    this.ownedMaterials.length = 0;
    for (const t of this.ownedTextures) {
      t.dispose();
    }
    this.ownedTextures.length = 0;
  }
}
