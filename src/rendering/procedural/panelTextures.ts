/**
 * rendering/procedural/panelTextures.ts — Procedural texture generators for
 * the Aperture material library. Pure functions over typed arrays (no canvas,
 * no Babylon) so they run in node tests and are fully deterministic.
 *
 * Conventions:
 *  - One texture == one 2m panel at `size` px (256px → 128px/m texel density).
 *  - albedo is sRGB RGBA; normal is tangent-space OpenGL (+Y); the
 *    metallicRoughness map packs R=AO, G=roughness, B=metallic (Babylon's
    metallic-workflow channel convention).
 *  - All generators are seeded → byte-identical output across runs.
 */
import { fbm2, hash2i, mulberry32 } from './random';
import { heightToNormal } from './heightToNormal';
import { PixelBuffer, rgba } from './pixelBuffer';

export interface GeneratedMaps {
  readonly size: number;
  /** sRGB RGBA. */
  readonly albedo: Uint8ClampedArray;
  /** Tangent-space normal, OpenGL +Y convention. */
  readonly normal: Uint8ClampedArray;
  /** R = ambient occlusion, G = roughness, B = metallic (linear 0..1 → 0..255). */
  readonly metallicRoughness: Uint8ClampedArray;
  /** Optional additively-lit emissive map (sRGB RGBA), e.g. button ring. */
  readonly emissive?: Uint8ClampedArray;
}

/** Sobel strength: height fields are 0..1, so ~0.6 gives readable grooves
 * without sparkling at grazing angles. */
const NORMAL_STRENGTH = 0.55;

/** Working set for one texture build. */
class PaintContext {
  readonly height: Float32Array;
  readonly albedo: PixelBuffer;
  readonly mr: PixelBuffer; // R=AO, G=roughness, B=metallic
  readonly rng: () => number;

  constructor(
    readonly size: number,
    seed: number,
  ) {
    this.height = new Float32Array(size * size);
    this.albedo = new PixelBuffer(size, size);
    this.mr = new PixelBuffer(size, size);
    this.rng = mulberry32(seed);
  }

  heightIndex(x: number, y: number): number {
    return y * this.size + x;
  }
}

function makeContext(size: number, seed: number): PaintContext {
  return new PaintContext(size, seed);
}

function finishMaps(ctx: PaintContext, emissive?: Uint8ClampedArray): GeneratedMaps {
  const maps: GeneratedMaps = {
    size: ctx.size,
    albedo: ctx.albedo.data,
    normal: heightToNormal(ctx.height, ctx.size, ctx.size, NORMAL_STRENGTH),
    metallicRoughness: ctx.mr.data,
  };
  if (emissive) {
    return { ...maps, emissive };
  }
  return maps;
}

function forEachPixel(size: number, fn: (x: number, y: number, u: number, v: number) => void): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      fn(x, y, x / size, y / size);
    }
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function setMr(ctx: PaintContext, x: number, y: number, ao: number, roughness: number, metallic: number): void {
  ctx.mr.set(x, y, rgba(clamp01(ao) * 255, clamp01(roughness) * 255, clamp01(metallic) * 255));
}

/** Recessed groove around the panel border — the modular-panel seam. */
function paintSeam(ctx: PaintContext, grooveDepth: number, albedoDarken: number, aoDrop: number): void {
  const size = ctx.size;
  const seamWidth = Math.max(2, Math.round(size * 0.012));
  forEachPixel(size, (x, y) => {
    const d = Math.min(x, y, size - 1 - x, size - 1 - y);
    if (d >= seamWidth) return;
    const profile = 1 - d / seamWidth; // 1 at the very edge, 0 at groove inner lip
    const shaped = profile * profile * (3 - 2 * profile);
    const i = ctx.heightIndex(x, y);
    ctx.height[i] -= shaped * grooveDepth;
    const i4 = (y * size + x) * 4;
    ctx.albedo.data[i4] *= 1 - albedoDarken * shaped;
    ctx.albedo.data[i4 + 1] *= 1 - albedoDarken * shaped;
    ctx.albedo.data[i4 + 2] *= 1 - albedoDarken * shaped;
    ctx.mr.data[i4] = Math.min(ctx.mr.data[i4], (1 - aoDrop * shaped) * 255);
  });
}

/** Faint grime accumulation toward the panel corners. */
function addCornerGrime(ctx: PaintContext, seed: number, strength: number): void {
  const size = ctx.size;
  const radius = size * 0.32;
  forEachPixel(size, (x, y, u, v) => {
    const d = Math.min(
      Math.hypot(x, y),
      Math.hypot(size - 1 - x, y),
      Math.hypot(x, size - 1 - y),
      Math.hypot(size - 1 - x, size - 1 - y),
    );
    const falloff = clamp01(1 - d / (size * 0.3));
    const grime = falloff * falloff * fbm2(u * 6, v * 6, 3, seed + 31) * strength;
    if (grime <= 0.003) return;
    const i4 = (y * size + x) * 4;
    ctx.albedo.data[i4] *= 1 - grime * 0.14;
    ctx.albedo.data[i4 + 1] *= 1 - grime * 0.14;
    ctx.albedo.data[i4 + 2] *= 1 - grime * 0.14;
    ctx.mr.data[i4] = Math.max(0, ctx.mr.data[i4] - grime * 0.12 * 255);
  });
}

/** Hairline scratches: thin random strokes, slightly darker + polished. */
function addMicroScratches(ctx: PaintContext, count: number, brighten: boolean): void {
  const size = ctx.size;
  for (let s = 0; s < count; s++) {
    const x0 = ctx.rng() * size;
    const y0 = ctx.rng() * size;
    const angle = ctx.rng() * Math.PI * 2;
    const length = size * (0.05 + ctx.rng() * 0.2);
    const x1 = x0 + Math.cos(angle) * length;
    const y1 = y0 + Math.sin(angle) * length;
    const shade = brighten ? 26 : -14;
    const x0i = Math.round(x0);
    const y0i = Math.round(y0);
    const x1i = Math.round(x0 + Math.cos(angle) * length);
    const y1i = Math.round(y0 + Math.sin(angle) * length);
    scratchStroke(ctx, x0i, y0i, x1i, y1i, shade);
  }
}

function scratchStroke(ctx: PaintContext, x0: number, y0: number, x1: number, y1: number, shade: number): void {
  const size = ctx.size;
  const minX = Math.max(0, Math.min(x0, x1) - 1);
  const maxX = Math.min(size - 1, Math.max(x0, x1) + 1);
  const minY = Math.max(0, Math.min(y0, y1) - 1);
  const maxY = Math.min(size - 1, Math.max(y0, y1) + 1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = (x1 - x0) ** 2 + (y1 - y0) ** 2;
  for (let y = Math.max(0, Math.floor(min2(y0, y1) - 1)); y <= Math.min(size - 1, Math.ceil(Math.max(y0, y1) + 1)); y++) {
    for (let x = Math.max(0, Math.floor(Math.min(x0Bounds(x0, x1)) - 1)); x <= maxXBound(x0, x1, size); x++) {
      // cheap 1px stroke: only paint pixels within ~0.6px of the segment
      const t = segmentT(x, y, x0, y0, x1, y1);
      const px = x0 + t * (x1 - x0);
      const py = y0 + t * (y1 - y0);
      if (Math.hypot(x - px, y - py) > 0.6) continue;
      const i4 = (y * size + x) * 4;
      ctx.albedo.data[i4] = clamp255(ctx.albedo.data[i4] + shade);
      ctx.albedo.data[i4 + 1] = clamp255(ctx.albedo.data[i4 + 1] + shade);
      ctx.albedo.data[i4 + 2] = clamp255(ctx.albedo.data[i4 + 2] + shade);
      ctx.height[y * size + x] -= 0.012;
      // scratches are polished: roughness dips slightly
      ctx.mr.data[i4 + 1] = Math.max(0, ctx.mr.data[i4 + 1] - 18);
    }
  }
}
