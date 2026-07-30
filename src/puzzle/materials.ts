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
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = `rgba(${Math.floor(color.r * 255)}, ${Math.floor(color.g * 255)}, ${Math.floor(color.b * 255)}, 0.45)`;
    ctx.lineWidth = 2;
    for (let i = 0; i <= size; i += 16) {
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
    m.emissiveColor = color;
    m.emissiveTexture = texture;
    m.opacityTexture = texture;
    m.alpha = 0.55;
    m.alphaMode = 1;
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
        const r = 20 + Math.floor(noise * 60);
        const g = 40 + Math.floor(noise * 120);
        const b = 20 + Math.floor(noise * 40);
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
    m.emissiveColor = new Color3(0.1, 0.5, 0.1);
    m.emissiveTexture = texture;
    m.specularColor = Color3.White();
    m.alpha = 0.92;
    m.alphaMode = 1;
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
