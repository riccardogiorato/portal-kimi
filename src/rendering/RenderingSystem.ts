/**
 * rendering/RenderingSystem.ts — The Aperture Science render stack.
 *
 * Orchestrates the procedural PBR material library, lighting + procedural IBL,
 * filmic post-process pipeline, quality scaling, chamber moods, trauma-based
 * screen shake, dust motes and fake volumetric light shafts. Implements
 * IRenderingSystem exactly; the constructor stays parameterless (Game.ts calls
 * `new RenderingSystem()`).
 *
 * Camera-dependent work (post-process attach, shake, dust follow) is deferred
 * to the first update() that finds an active camera, because the player camera
 * is created AFTER rendering.init() (see the init order in core/Game.ts).
 */
import type { AbstractMesh, Mesh, Scene, UniversalCamera, Vector3 } from '@babylonjs/core';
import type { GameConfig } from '../core/Config';
import type { ChamberMood, IGameContext, IMaterialLibrary, IRenderingSystem, QualityLevel } from '../core/types';
import { MaterialLibrary } from './materials';
import { EnvironmentStack } from './environment';
import { PostProcessStack } from './postProcess';
import { Ambience } from './ambience';
import { applyShakeAdditive, ScreenShake, type ShakeOffset } from './shake';
import { qualitySettingsFor, type QualitySettings } from './quality';

export class RenderingSystem implements IRenderingSystem {
  readonly name = 'rendering';

  private scene!: Scene;
  private renderingConfig!: GameConfig['rendering'];
  private matLib: MaterialLibrary | null = null;
  private environment: EnvironmentStack | null = null;
  private postProcess: PostProcessStack | null = null;
  private ambience: Ambience | null = null;
  private shaker = new ScreenShake();
  private quality!: QualitySettings;

  private pipelineAttached = false;
  private postEffectsDisabled = false;
  private disposed = false;
  private unsubSettings: (() => void) | null = null;

  // Per-frame shake scratch (no allocation in update()).
  private readonly shakeOffset: ShakeOffset = { pitch: 0, yaw: 0, roll: 0 };

  get materials(): IMaterialLibrary {
    if (!this.matLib) throw new Error('RenderingSystem not initialized');
    return this.matLib;
  }

  init(ctx: IGameContext): void {
    this.scene = ctx.scene;
    this.renderingConfig = ctx.config.rendering;
    this.quality = qualitySettingsFor(ctx.settings.settings.quality, this.renderingConfig);

    this.matLib = new MaterialLibrary(this.scene, this.quality.panelTextureSize, this.quality.heroTextureSize);
    this.matLib.build();

    this.environment = new EnvironmentStack(this.scene);
    this.environment.build();
    this.environment.setQuality(this.quality);
    this.environment.setMood('clean');

    this.postProcess = new PostProcessStack(this.scene);
    this.ambience = new Ambience(this.scene);
    this.ambience.build(this.quality);

    // React to live quality changes from the settings menu.
    this.unsubSettings = ctx.events.on('settings:changed', (p) => this.applyQuality(p.settings.quality));
  }

  applyQuality(level: QualityLevel): void {
    this.quality = qualitySettingsFor(level, this.renderingConfig);
    // Rebuild shared material textures in place when the resolved texel density
    // changes — existing Material instances are kept (textures swapped on them)
    // so consumers' cached references stay valid.
    this.matLib?.setQuality(this.quality.panelTextureSize, this.quality.heroTextureSize);
    this.environment?.setQuality(this.quality);
    this.postProcess?.setQuality(this.quality);
    this.ambience?.setQuality(this.quality);
  }

  setMood(mood: ChamberMood): void {
    this.environment?.setMood(mood);
  }

  shake(intensity: number): void {
    this.shaker.add(intensity);
  }

  update(dtSeconds: number): void {
    if (this.disposed) return;
    const camera = this.scene.activeCamera as UniversalCamera | null;

    // Lazily attach the post-process stack to the player camera once it exists.
    if (!this.pipelineAttached && !this.postEffectsDisabled && camera && this.postProcess) {
      this.postProcess.attach(camera, this.quality);
      this.pipelineAttached = true;
    }

    // Mood damping -> lights/IBL/clearColor + exposure for tone mapping.
    const exposure = this.environment?.update(dtSeconds) ?? 1;
    this.postProcess?.setExposure(exposure);

    // Trauma shake: the player controller writes a fresh unshaken base rotation
    // every frame (before rendering.update), so we ONLY ADD the current frame's
    // offset. Never subtract a previous offset — that would invert the shake and
    // accumulate drift, since the player's next write already discarded it.
    if (camera) {
      this.shaker.update(dtSeconds, this.shakeOffset);
      applyShakeAdditive(camera.rotation, this.shakeOffset);
    } else {
      // No camera yet (pre-player): keep trauma decaying so a queued shake
      // doesn't dump all at once when the camera appears.
      this.shaker.update(dtSeconds, this.shakeOffset);
    }

    if (camera) this.ambience?.update(camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubSettings?.();
    this.unsubSettings = null;
    this.ambience?.dispose();
    this.postProcess?.dispose();
    // Materials reference scene.environmentTexture (the IBL) during disposal,
    // so tear down the material library BEFORE the environment that owns the IBL.
    this.matLib?.dispose();
    this.environment?.dispose();
    this.shaker.reset();
  }

  // --- Concrete-class extras (beyond IRenderingSystem; see report) ---------

  /**
   * Circuit breaker (Game calls this when scene.render() throws): first tier
   * disables only SSAO — its onApply can throw per-frame on drivers without
   * proper prepass/geometry-buffer support, blacking out the canvas.
   */
  disableSSAO(): void {
    this.postProcess?.disableSSAO();
  }

  /** Last-resort circuit breaker: kill the whole post stack, never re-attach. */
  disablePostEffects(): void {
    this.postEffectsDisabled = true;
    this.postProcess?.disablePostEffects();
    this.pipelineAttached = false;
  }

  /** Register a mesh to cast shadows from the key light (levels/puzzle call this). */
  addShadowCaster(mesh: AbstractMesh): void {
    this.environment?.addShadowCaster(mesh);
  }

  removeShadowCaster(mesh: AbstractMesh): void {
    this.environment?.removeShadowCaster(mesh);
  }

  /** Request a fake volumetric light shaft at a position (levels call this). */
  requestLightShaft(position: Vector3, height?: number, width?: number): Mesh | null {
    return this.ambience?.requestShaft(position, height, width) ?? null;
  }

  clearLightShafts(): void {
    this.ambience?.clearShafts();
  }
}