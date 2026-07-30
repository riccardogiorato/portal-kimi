/**
 * rendering/ambience.ts — Dust motes + fake volumetric light shafts.
 *
 * One shared ParticleSystem of slowly drifting dust motes (procedural soft-dot
 * texture, additive) whose emitter follows the active camera so dust is always
 * present around the player without coupling to the player system. Budget is
 * quality-scaled (0 disables). Light shafts are additive billboard planes with
 * a procedural gradient alpha texture; levels request them at positions via
 * requestShaft(). Everything is disposed in dispose() / clearShafts().
 */
import { Color3, Color4, Constants, Mesh, MeshBuilder, ParticleSystem, RawTexture, StandardMaterial, Vector3 } from '@babylonjs/core';
import type { Camera, Scene } from '@babylonjs/core';
import type { QualitySettings } from './quality';

interface Shaft {
  mesh: Mesh;
}

export class Ambience {
  private dust: ParticleSystem | null = null;
  private dustTexture: RawTexture | null = null;
  private dustCapacity = 0;

  private shafts: Shaft[] = [];
  private shaftMaterial: StandardMaterial | null = null;
  private shaftTexture: RawTexture | null = null;
  private maxShafts = 0;

  constructor(private readonly scene: Scene) {}

  build(settings: QualitySettings): void {
    this.maxShafts = settings.maxLightShafts;
    this.buildShaftAssets();
    this.setQuality(settings);
  }

  setQuality(settings: QualitySettings): void {
    this.maxShafts = settings.maxLightShafts;
    if (settings.dustCapacity !== this.dustCapacity) {
      this.disposeDust();
      if (settings.dustCapacity > 0) this.buildDust(settings.dustCapacity);
    }
  }

  /** Move the dust volume to follow the active camera (zero allocation). */
  update(camera: Camera): void {
    if (this.dust) this.dust.emitter = camera.position;
  }

  // --- Light shafts -------------------------------------------------------

  /**
   * Request a fake volumetric light shaft at a position. Returns the created
   * mesh (so a level can reposition/remove it) or null if the budget is empty.
   * Shafts are additive billboards that keep upright and face the camera.
   */
  requestShaft(position: Vector3, height = 6, width = 1.6): Mesh | null {
    if (!this.shaftMaterial || this.maxShafts <= 0) return null;
    // Ring-buffer: if at budget, recycle the oldest slot.
    if (this.shafts.length >= this.maxShafts) {
      const oldest = this.shafts.shift();
      oldest?.mesh.dispose();
    }
    const mesh = MeshBuilder.CreatePlane(
      `render-shaft-${this.shafts.length}`,
      { width, height, sideOrientation: Mesh.DOUBLESIDE },
      this.scene,
    );
    mesh.position.copyFrom(position);
    mesh.billboardMode = Mesh.BILLBOARDMODE_Y; // upright, faces camera horizontally
    mesh.material = this.shaftMaterial;
    mesh.isPickable = false; // shafts are purely visual — never raycast/block
    mesh.alwaysSelectAsActiveMesh = true; // additive alpha planes can be frustum-culled wrongly
    this.shafts.push({ mesh });
    return mesh;
  }

  clearShafts(): void {
    for (const s of this.shafts) s.mesh.dispose();
    this.shafts.length = 0;
  }

  // -----------------------------------------------------------------------

  private buildDust(capacity: number): void {
    const dust = new ParticleSystem('render-dust', capacity, this.scene);
    this.dustTexture = this.makeSoftDotTexture();
    dust.particleTexture = this.dustTexture;
    this.dustTexture.hasAlpha = true;

    dust.emitter = Vector3.Zero();
    dust.createBoxEmitter(
      new Vector3(-0.1, -0.04, -0.1),
      new Vector3(0.1, 0.04, 0.1),
      new Vector3(-6, -2, -6),
      new Vector3(6, 2, 6),
    );
    dust.color1 = new Color4(0.9, 0.9, 0.92, 0.5);
    dust.color2 = new Color4(0.78, 0.8, 0.85, 0.42);
    dust.colorDead = new Color4(0.7, 0.7, 0.72, 0);
    dust.minSize = 0.02;
    dust.maxSize = 0.06;
    dust.minLifeTime = 6;
    dust.maxLifeTime = 14;
    dust.emitRate = capacity / 10; // steady state ~= capacity
    dust.blendMode = ParticleSystem.BLENDMODE_ADD;
    dust.gravity = Vector3.Zero();
    dust.minEmitPower = 0.02;
    dust.maxEmitPower = 0.05;
    dust.minAngularSpeed = 0;
    dust.maxAngularSpeed = 0;
    dust.updateSpeed = 0.01;
    dust.start();
    this.dust = dust;
    this.dustCapacity = capacity;
  }

  private disposeDust(): void {
    this.dust?.stop(true);
    this.dust?.dispose();
    this.dust = null;
    this.dustTexture?.dispose();
    this.dustTexture = null;
    this.dustCapacity = 0;
  }

  private buildShaftAssets(): void {
    if (this.shaftMaterial) return;
    this.shaftTexture = this.makeShaftGradientTexture();
    const mat = new StandardMaterial('render-shaft-mat', this.scene);
    mat.emissiveColor = new Color3(1, 0.97, 0.9);
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    mat.opacityTexture = this.shaftTexture;
    mat.useAlphaFromDiffuseTexture = false;
    mat.alphaMode = Constants.ALPHA_ADD; // additive god-ray
    mat.backFaceCulling = false;
    mat.alpha = 0.5;
    this.shaftMaterial = mat;
  }

  /** Radial soft dot for dust (white core fading to transparent). */
  private makeSoftDotTexture(): RawTexture {
    const size = 32;
    const data = new Uint8Array(size * size * 4);
    const c = (size - 1) / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - c, y - c) / c;
        const a = Math.max(0, 1 - d);
        const aa = a * a; // soft falloff
        const i = (y * size + x) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.round(aa * 255);
      }
    }
    const tex = RawTexture.CreateAlphaTexture(data, size, size, this.scene, false, false, Constants.TEXTURE_TRILINEAR_SAMPLINGMODE);
    tex.name = 'render-dust-dot';
    return tex;
  }

  /** Vertical gradient with a soft horizontal core for light-shaft billboards. */
  private makeShaftGradientTexture(): RawTexture {
    const w = 32;
    const h = 128;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const topness = 1 - y / h; // 1 at top
      const vFade = topness * topness; // bright top, transparent bottom
      for (let x = 0; x < w; x++) {
        const hFade = Math.max(0, 1 - Math.pow((x - w / 2) / (w / 2), 2));
        const a = vFade * hFade;
        const i = (y * w + x) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.round(a * 255);
      }
    }
    const tex = RawTexture.CreateRGBATexture(data, w, h, this.scene, false, false, Constants.TEXTURE_TRILINEAR_SAMPLINGMODE);
    tex.hasAlpha = true;
    tex.name = 'render-shaft-gradient';
    return tex;
  }

  dispose(): void {
    this.disposeDust();
    this.clearShafts();
    this.shaftMaterial?.dispose();
    this.shaftMaterial = null;
    this.shaftTexture?.dispose();
    this.shaftTexture = null;
  }
}