/**
 * rendering/postProcess.ts — Filmic post-process stack.
 *
 * DefaultRenderingPipeline (MSAA + FXAA + bloom + ACES tone mapping + vignette
 * + film grain + subtle chromatic aberration) plus SSAO2 at high/ultra. SSAO2
 * needs a geometry/prepass buffer that headless or WebGL1 contexts can't
 * provide, so its creation is wrapped and skipped gracefully on failure. The
 * pipeline attaches lazily to the active camera (the player camera does not
 * exist at rendering.init time — it is created later by the player system).
 */
import { Color4 } from '@babylonjs/core';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import type { Camera, ImageProcessingConfiguration as IPC, Scene } from '@babylonjs/core';
import { CONFIG } from '../core/Config';
import type { QualitySettings } from './quality';

/** Chromatic aberration amount (subtle — Portal 2 has almost none). */
const CHROMATIC_ABERRATION = 1.4;
const CHROMATIC_RADIAL = 0.25;

export class PostProcessStack {
  private pipeline: DefaultRenderingPipeline | null = null;
  private ssao: SSAO2RenderingPipeline | null = null;
  private config: IPC | null = null;
  private attached = false;

  constructor(private readonly scene: Scene) {}

  /** Create and attach the pipeline to the given (main) camera. Idempotent. */
  attach(camera: Camera, settings: QualitySettings): void {
    if (this.attached) {
      this.setQuality(settings);
      return;
    }
    const pipeline = new DefaultRenderingPipeline('render-pipeline', true, this.scene, [camera], true);
    pipeline.samples = settings.msaaSamples; // MSAA on the render target
    pipeline.fxaaEnabled = true;
    pipeline.bloomEnabled = settings.bloomEnabled;
    pipeline.bloomWeight = CONFIG.rendering.bloomWeight;
    pipeline.bloomThreshold = CONFIG.rendering.bloomThreshold;
    pipeline.bloomScale = 0.5;
    pipeline.bloomKernel = 64;

    pipeline.imageProcessingEnabled = true;
    const ipp = pipeline.imageProcessing;
    const cfg = ipp.imageProcessingConfiguration;
    cfg.toneMappingEnabled = true;
    cfg.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    cfg.contrast = CONFIG.rendering.contrast;
    cfg.exposure = CONFIG.rendering.exposure;
    ipp.vignetteEnabled = true;
    ipp.vignetteWeight = CONFIG.rendering.vignetteWeight;
    ipp.vignetteColor = new Color4(0, 0, 0.02, 1);

    pipeline.grainEnabled = settings.grainEnabled;
    pipeline.grain.intensity = CONFIG.rendering.grainIntensity;
    pipeline.grain.animated = true;

    pipeline.chromaticAberrationEnabled = settings.chromaticAberrationEnabled;
    pipeline.chromaticAberration.aberrationAmount = CHROMATIC_ABERRATION;
    pipeline.chromaticAberration.radialIntensity = CHROMATIC_RADIAL;

    this.pipeline = pipeline;
    this.config = cfg;
    this.attached = true;
    this.applySSAO(camera, settings);
  }

  /** Reconfigure quality-dependent settings without leaking resources. */
  setQuality(settings: QualitySettings): void {
    if (this.pipeline) {
      this.pipeline.samples = settings.msaaSamples;
      this.pipeline.chromaticAberrationEnabled = settings.chromaticAberrationEnabled;
      // Bloom + grain stay on across tiers (they define the look); only the
      // emissive CA pass is tier-gated (extra cost).
    }
    if (this.attached) {
      const camera = this.scene.activeCamera;
      if (camera) this.applySSAO(camera, settings);
    }
  }

  /** Drive the ACES exposure from the live mood each frame. */
  setExposure(value: number): void {
    if (this.config) this.config.exposure = value;
  }

  dispose(): void {
    this.disableSSAO();
    this.pipeline?.dispose();
    this.pipeline = null;
    this.config = null;
    this.attached = false;
  }

  /**
   * Tear down ONLY SSAO (circuit-breaker path: SSAO's onApply can throw
   * per-frame on drivers without proper prepass/geometry-buffer support,
   * which aborts scene.render mid-frame and blacks out the canvas).
   */
  disableSSAO(): void {
    if (this.ssao) {
      try {
        this.ssao.dispose(true);
      } catch {
        // Headless/unsupported contexts — already torn down or never built.
      }
      this.ssao = null;
    }
  }

  /** Tear down the whole stack (last-resort circuit breaker). */
  disablePostEffects(): void {
    this.dispose();
  }

  // -----------------------------------------------------------------------

  /** Create or tear down SSAO2 for the current tier (graceful on failure). */
  private applySSAO(camera: Camera, settings: QualitySettings): void {
    if (!settings.ssao) {
      // Tier dropped below high: remove the existing SSAO2 pipeline cleanly.
      if (this.ssao) {
        try {
          this.ssao.dispose(true);
        } catch {
          // ignore
        }
        this.ssao = null;
      }
      return;
    }
    if (this.ssao) return; // already enabled at a high tier
    try {
      // forceGeometryBuffer=true is REQUIRED: the default prepass path reads
      // depth/normal via dynamic getIndex() slots that are never configured
      // for a lazily-attached pipeline (getIndex → -1 → onApply throws every
      // frame → scene.render aborts → black canvas). The geometry-buffer
      // branch uses fixed GBuffer texture indices and sidesteps it entirely.
      const ssao = new SSAO2RenderingPipeline(
        'render-ssao2',
        this.scene,
        { ssaoRatio: settings.ssaoRatio, blurRatio: 1.0 },
        [camera],
        true,
      );
      ssao.samples = settings.ssaoSamples;
      ssao.radius = 1.6;
      ssao.expensiveBlur = true;
      // The constructor early-returns a half-pipeline when unsupported
      // (no post processes created) — detect and drop it.
      const built = (ssao as unknown as { _ssaoPostProcess?: unknown })._ssaoPostProcess !== undefined;
      if (!built) {
        console.warn('[rendering] SSAO2 unsupported in this context, disabling');
        ssao.dispose(true);
        this.ssao = null;
        return;
      }
      this.ssao = ssao;
    } catch (error) {
      // WebGL2/geometry-buffer unsupported (or headless test ctx): skip SSAO.
      this.ssao = null;
      console.warn('[rendering] SSAO2 unavailable, skipping:', error);
    }
  }
}