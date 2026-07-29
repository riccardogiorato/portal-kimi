/**
 * STUB — replaced by the rendering subsystem agent.
 * Provides minimal lighting + flat materials so the scene is visible before
 * the real PBR/post-process stack lands.
 */
import { Color3, Color4, HemisphericLight, StandardMaterial, Vector3, type Material, type Scene } from '@babylonjs/core';
import type { ChamberMood, IGameContext, IMaterialLibrary, IRenderingSystem, QualityLevel } from '../core/types';

class StubMaterials implements IMaterialLibrary {
  private readonly cache = new Map<string, StandardMaterial>();
  constructor(private readonly scene: Scene) {}
  private get(key: string, color: Color3): Material {
    let mat = this.cache.get(key);
    if (!mat) {
      mat = new StandardMaterial(`stub-${key}`, this.scene);
      mat.diffuseColor = color;
      this.cache.set(key, mat);
    }
    return mat;
  }
  wallPanel(portalable: boolean): Material {
    return this.get(portalable ? 'wall-white' : 'wall-dark', portalable ? new Color3(0.85, 0.85, 0.87) : new Color3(0.2, 0.22, 0.25));
  }
  floorPanel(): Material {
    return this.get('floor', new Color3(0.55, 0.55, 0.58));
  }
  ceilingPanel(): Material {
    return this.get('ceiling', new Color3(0.7, 0.7, 0.72));
  }
  trimMetal(): Material {
    return this.get('trim', new Color3(0.4, 0.42, 0.45));
  }
  darkMetal(): Material {
    return this.get('dark', new Color3(0.15, 0.16, 0.18));
  }
  glass(): Material {
    return this.get('glass', new Color3(0.6, 0.8, 0.9));
  }
  emissive(color: Color3, _intensity?: number): Material {
    const mat = new StandardMaterial('stub-emissive', this.scene);
    mat.emissiveColor = color;
    return mat;
  }
  cubeShell(): Material {
    return this.get('cube', new Color3(0.8, 0.8, 0.82));
  }
  buttonHousing(): Material {
    return this.get('button', new Color3(0.3, 0.3, 0.32));
  }
}

export class RenderingSystem implements IRenderingSystem {
  readonly name = 'rendering';
  private light?: HemisphericLight;
  private matLib?: StubMaterials;

  get materials(): IMaterialLibrary {
    if (!this.matLib) throw new Error('RenderingSystem not initialized');
    return this.matLib;
  }

  init(ctx: IGameContext): void {
    ctx.scene.clearColor = new Color4(0.04, 0.05, 0.08, 1);
    this.light = new HemisphericLight('stubLight', new Vector3(0.3, 1, 0.2), ctx.scene);
    this.light.diffuse = new Color3(1, 1, 1);
    this.light.intensity = 0.9;
    this.matLib = new StubMaterials(ctx.scene);
  }
  update(_dtSeconds: number): void {}
  applyQuality(_level: QualityLevel): void {}
  setMood(_mood: ChamberMood): void {}
  shake(_intensity: number): void {}
  dispose(): void {
    this.light?.dispose();
  }
}
