/**
 * rendering/environment.ts — Lighting, procedural IBL and chamber mood.
 *
 * Owns the single key directional light (the only shadow caster), a hemispheric
 * fill, and a fully procedural cube-map environment built from RGBA face buffers
 * (RawCubeTexture — no asset load). The live mood bundle is damped toward the
 * active target every frame (core/math `damp`), so setMood cross-fades instead
 * of snapping; the damaged mood drives a deterministic fluorescent flicker.
 */
import { Color3, Color4, Constants, DirectionalLight, HemisphericLight, RawCubeTexture, Vector3 } from '@babylonjs/core';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { AbstractMesh, Scene } from '@babylonjs/core';
import { CONFIG } from '../core/Config';
import type { ChamberMood } from '../core/types';
import { type MoodTargets, MOOD_TARGETS, cloneMood, dampMoodInPlace, flickerMultiplier } from './moods';
import type { QualitySettings } from './quality';

/** Mood cross-fade rate (per second); ~1s to settle. */
const MOOD_LAMBDA = 2.5;
/** IBL cube face resolution. Small is plenty for soft ambient lighting. */
const ENV_FACE_SIZE = 64;

export class EnvironmentStack {
  private key!: DirectionalLight;
  private hemi!: HemisphericLight;
  private shadowGen: ShadowGenerator | null = null;
  private envTexture: RawCubeTexture | null = null;

  private live: MoodTargets = cloneMood(MOOD_TARGETS.clean);
  private target: MoodTargets = MOOD_TARGETS.clean;
  private elapsedSeconds = 0;

  /** Current damped exposure (post tone-mapping) for the post-process stack. */
  get exposure(): number {
    return CONFIG.rendering.exposure * this.live.exposureMultiplier;
  }

  constructor(private readonly scene: Scene) {}

  build(): void {
    // Key directional light — the only shadow-casting light.
    const dir = new Vector3(-0.55, -1, -0.35).normalize();
    this.key = new DirectionalLight('render-key', dir, this.scene);
    this.key.position = new Vector3(14, 26, 12);
    this.key.shadowFrustumSize = 32; // ortho frustum covers a chamber
    this.key.autoCalcShadowZBounds = true;
    this.key.intensity = this.live.keyIntensity;
    this.key.diffuse = new Color3(this.live.keyColor.r, this.live.keyColor.g, this.live.keyColor.b);

    // Hemispheric fill — sky/ground colors track the mood.
    this.hemi = new HemisphericLight('render-hemi', Vector3.Up(), this.scene);
    this.hemi.intensity = this.live.hemiIntensity;
    this.hemi.diffuse = new Color3(this.live.hemiSky.r, this.live.hemiSky.g, this.live.hemiSky.b);
    this.hemi.groundColor = new Color3(this.live.hemiGround.r, this.live.hemiGround.g, this.live.hemiGround.b);

    this.envTexture = this.buildEnvironmentCube();
    this.scene.environmentTexture = this.envTexture;
    this.scene.environmentIntensity = this.live.environmentIntensity;
    this.scene.clearColor = new Color4(this.live.clearColor.r, this.live.clearColor.g, this.live.clearColor.b, 1);
  }

  /** Recreate/resize the shadow map for a quality tier; 0 disables shadows. */
  setQuality(settings: QualitySettings): void {
    const size = settings.shadowMapSize;
    if (size <= 0) {
      this.shadowGen?.dispose();
      this.shadowGen = null;
      this.key.shadowEnabled = false;
      return;
    }
    if (!this.shadowGen) {
      this.shadowGen = new ShadowGenerator(size, this.key);
      this.shadowGen.bias = 0.012;
      this.shadowGen.normalBias = 0.02;
    } else {
      this.shadowGen.mapSize = size;
    }
    this.key.shadowEnabled = true;
  }

  setMood(mood: ChamberMood): void {
    this.target = MOOD_TARGETS[mood];
  }

  /** Register a mesh as a shadow caster (levels/puzzle call this for static + dynamic geometry). */
  addShadowCaster(mesh: AbstractMesh): void {
    this.shadowGen?.addShadowCaster(mesh, true);
  }

  removeShadowCaster(mesh: AbstractMesh): void {
    this.shadowGen?.removeShadowCaster(mesh, true);
  }

  /** Advance the mood damping, apply flicker, and return the live exposure. */
  update(dt: number): number {
    this.elapsedSeconds += dt;
    dampMoodInPlace(this.live, this.target, MOOD_LAMBDA, dt);

    const flicker = flickerMultiplier(this.elapsedSeconds, this.live.flicker);
    this.key.intensity = this.live.keyIntensity * flicker;
    setColor3(this.key.diffuse, this.live.keyColor);

    // Fill flickers softer than the key so the room never goes fully black.
    this.hemi.intensity = this.live.hemiIntensity * (0.7 + 0.3 * flicker);
    setColor3(this.hemi.diffuse, this.live.hemiSky);
    setColor3(this.hemi.groundColor, this.live.hemiGround);

    this.scene.environmentIntensity = this.live.environmentIntensity;
    setColor4(this.scene.clearColor, this.live.clearColor, 1);
    return this.exposure;
  }

  dispose(): void {
    this.shadowGen?.dispose();
    this.shadowGen = null;
    const env = this.envTexture;
    this.envTexture = null;
    if (env) {
      // Clear the scene reference before disposing so PBR materials stop sampling it.
      if (this.scene.environmentTexture === env) this.scene.environmentTexture = null;
      env.dispose();
    }
    this.key.dispose();
    this.hemi.dispose();
  }

  // -----------------------------------------------------------------------

  /** Build a 6-face RGBA cube map: dark floor, bright ceiling-strip, neutral sides. */
  private buildEnvironmentCube(): RawCubeTexture {
    const s = ENV_FACE_SIZE;
    // Babylon cube face order: +X, -X, +Y, -Y, +Z, -Z.
    const faces: ArrayBufferView[] = [
      this.makeSideFace(s, 0x9e),
      this.makeSideFace(s, 0x92),
      this.makeTopFace(s), // ceiling: bright strip gradient
      this.makeBottomFace(s), // floor: dark
      this.makeSideFace(s, 0x96),
      this.makeSideFace(s, 0x8a),
    ];
    const cube = new RawCubeTexture(
      this.scene,
      faces,
      s,
      Constants.TEXTUREFORMAT_RGBA,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
      false, // generateMipMaps
      false, // invertY
      Constants.TEXTURE_TRILINEAR_SAMPLINGMODE,
    );
    cube.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    cube.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    cube.name = 'render-env-cube';
    return cube;
  }

  /** Ceiling face: a bright central strip-light band over a soft gradient. */
  private makeTopFace(s: number): Uint8Array {
    const out = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        // Central horizontal strip (light fixture) glowing brighter.
        const strip = Math.exp(-Math.pow((y - s * 0.5) / (s * 0.12), 2));
        const base = 0.3 + 0.2 * (1 - Math.abs(x / s - 0.5) * 2);
        const v = base + strip * 0.7;
        writeFacePixel(out, s, x, y, v * 255, v * 255 * 0.97, v * 255 * 0.9);
      }
    }
    return out;
  }

  /** Floor face: dark, slightly warmer. */
  private makeBottomFace(s: number): Uint8Array {
    const out = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const v = 18 + 6 * ((x + y) / s);
        writeFacePixel(out, s, x, y, v, v * 0.92, v * 0.8);
      }
    }
    return out;
  }

  /** Side face: neutral gradient medium->bright, bright band near the top (ceiling light). */
  private makeSideFace(s: number, tint: number): Uint8Array {
    const out = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) {
      const topness = 1 - y / s; // 1 at top
      // Vertical ambient gradient + a bright band at the very top.
      const band = Math.max(0, Math.exp(-Math.pow((topness - 0.92) / 0.06, 2)));
      const v = (0.2 + 0.3 * topness + band * 0.6) * tint;
      for (let x = 0; x < s; x++) {
        writeFacePixel(out, s, x, y, v, v * 0.98, v * 0.94);
      }
    }
    return out;
  }
}

function writeFacePixel(out: Uint8Array, size: number, x: number, y: number, r: number, g: number, b: number): void {
  const i = (y * size + x) * 4;
  out[i] = clamp8(r);
  out[i + 1] = clamp8(g);
  out[i + 2] = clamp8(b);
  out[i + 3] = 255;
}

function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Copy an RGB bundle into a Color3 in place (no allocation). */
function setColor3(target: Color3, src: { r: number; g: number; b: number }): void {
  target.r = src.r;
  target.g = src.g;
  target.b = src.b;
}

/** Copy an RGB bundle into a Color4 in place (no allocation). */
function setColor4(target: Color4, src: { r: number; g: number; b: number }, alpha: number): void {
  target.r = src.r;
  target.g = src.g;
  target.b = src.b;
  target.a = alpha;
}