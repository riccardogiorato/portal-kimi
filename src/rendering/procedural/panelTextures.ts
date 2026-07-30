/**
 * rendering/procedural/panelTextures.ts — Procedural texture generators for
 * the Aperture material library. Pure functions over typed arrays (no canvas,
 * no Babylon) so they run in node tests and are byte-identical across runs.
 *
 * Conventions:
 *  - One texture == one 2m panel at `size` px (256px -> ~128px/m texel density,
 *    512px for hero surfaces).
 *  - albedo is sRGB RGBA; normal is tangent-space OpenGL (+Y); the
 *    metallicRoughness map packs R=AO, G=roughness, B=metallic (the channel
 *    convention Babylon's metallic workflow reads with the
 *    useAmbientOcclusionFromMetallicTextureRed / useRoughnessFromMetallicTextureGreen
 *    / useMetallnessFromMetallicTextureBlue flags).
 *  - All generators are seeded -> deterministic output across runs/tiers.
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
  /** R = ambient occlusion, G = roughness, B = metallic (linear 0..1 -> 0..255). */
  readonly metallicRoughness: Uint8ClampedArray;
  /** Optional additively-lit emissive mask (sRGB RGBA), e.g. button accent ring. */
  readonly emissive?: Uint8ClampedArray;
}

/** Sobel strength: height fields are 0..1; ~0.55 reads grooves without sparkle. */
const NORMAL_STRENGTH = 0.55;

/** Working set for one texture build. Reused across passes to cut allocations. */
class PaintContext {
  readonly height: Float32Array;
  readonly albedo: PixelBuffer;
  readonly mr: PixelBuffer; // R=AO, G=roughness, B=metallic
  readonly emissive: PixelBuffer;
  readonly rng: () => number;

  constructor(
    readonly size: number,
    seed: number,
  ) {
    this.height = new Float32Array(size * size);
    this.albedo = new PixelBuffer(size, size);
    this.mr = new PixelBuffer(size, size);
    this.emissive = new PixelBuffer(size, size);
    this.rng = mulberry32(seed);
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Write the packed metallic/roughness/AO channels (each 0..1 -> 0..255). */
function setMr(ctx: PaintContext, x: number, y: number, ao: number, roughness: number, metallic: number): void {
  ctx.mr.set(x, y, rgba(clamp01(ao) * 255, clamp01(roughness) * 255, clamp01(metallic) * 255));
}

function forEachPixel(size: number, fn: (x: number, y: number, u: number, v: number) => void): void {
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      fn(x, y, x * inv, y * inv);
    }
  }
}

/** Finish: bake the normal map from the height field and collect buffers. */
function finishMaps(ctx: PaintContext, withEmissive: boolean): GeneratedMaps {
  const maps: GeneratedMaps = {
    size: ctx.size,
    albedo: ctx.albedo.data,
    normal: heightToNormal(ctx.height, ctx.size, ctx.size, NORMAL_STRENGTH),
    metallicRoughness: ctx.mr.data,
  };
  return withEmissive ? { ...maps, emissive: ctx.emissive.data } : maps;
}

// ---------------------------------------------------------------------------
// Shared feature painters
// ---------------------------------------------------------------------------

/** Recessed groove around the panel border — the modular-panel seam. */
function paintSeam(ctx: PaintContext, grooveDepth: number, albedoDarken: number, aoDrop: number): void {
  const size = ctx.size;
  const seamWidth = Math.max(2, Math.round(size * 0.012));
  forEachPixel(size, (x, y) => {
    const d = Math.min(x, y, size - 1 - x, size - 1 - y);
    if (d >= seamWidth) return;
    const profile = 1 - d / seamWidth; // 1 at the very edge, 0 at the groove lip
    const shaped = profile * profile * (3 - 2 * profile);
    const i = y * size + x;
    ctx.height[i] -= shaped * grooveDepth;
    const i4 = i * 4;
    const k = 1 - albedoDarken * shaped;
    ctx.albedo.data[i4] *= k;
    ctx.albedo.data[i4 + 1] *= k;
    ctx.albedo.data[i4 + 2] *= k;
    ctx.mr.data[i4] = Math.min(ctx.mr.data[i4], (1 - aoDrop * shaped) * 255);
  });
}

/** Faint grime accumulation toward the panel corners (darker + rougher). */
function addCornerGrime(ctx: PaintContext, seed: number, strength: number): void {
  const size = ctx.size;
  forEachPixel(size, (x, y, u, v) => {
    const d = Math.min(
      Math.hypot(x, y),
      Math.hypot(size - 1 - x, y),
      Math.hypot(x, size - 1 - y),
      Math.hypot(size - 1 - x, size - 1 - y),
    );
    const falloff = clamp01(1 - d / (size * 0.3));
    const grime = falloff * falloff * fbm2(u * 6, v * 6, 3, seed + 31) * strength;
    if (grime <= 0.004) return;
    const i4 = (y * size + x) * 4;
    ctx.albedo.data[i4] *= 1 - grime * 0.14;
    ctx.albedo.data[i4 + 1] *= 1 - grime * 0.14;
    ctx.albedo.data[i4 + 2] *= 1 - grime * 0.14;
    ctx.mr.data[i4 + 1] = Math.min(255, ctx.mr.data[i4 + 1] + grime * 0.12 * 255); // rougher where grimy
  });
}

/** Hairline scratches: thin anti-aliased strokes via PixelBuffer.strokeLine. */
function addMicroScratches(ctx: PaintContext, count: number, shade: number): void {
  const size = ctx.size;
  for (let s = 0; s < count; s++) {
    const x0 = ctx.rng() * size;
    const y0 = ctx.rng() * size;
    const angle = ctx.rng() * Math.PI * 2;
    const length = size * (0.05 + ctx.rng() * 0.22);
    const x1 = x0 + Math.cos(angle) * length;
    const y1 = y0 + Math.sin(angle) * length;
    const v = clamp255(200 + shade);
    ctx.albedo.strokeLine(x0, y0, x1, y1, 1.2, rgba(v, v, clamp255(205 + shade), 180));
    // Scratches are polished: carve a tiny groove + dip roughness along the stroke.
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - 1));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1) + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - 1));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1) + 1));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lenSq = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const t = ((x - x0) * dx + (y - y0) * dy) / lenSq;
        const tt = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = x0 + tt * dx;
        const py = y0 + tt * dy;
        if (Math.hypot(x - px, y - py) > 0.9) continue;
        ctx.height[y * size + x] -= 0.012;
        const i4 = (y * size + x) * 4;
        ctx.mr.data[i4 + 1] = Math.max(0, ctx.mr.data[i4 + 1] - 18);
      }
    }
  }
}

/** Brushed-metal streaks: high-frequency directional brightness modulation. */
function addBrushedStreaks(ctx: PaintContext, seed: number, frequency: number, amplitude: number): void {
  const size = ctx.size;
  forEachPixel(size, (x, y, u, v) => {
    const streak = (fbm2(u * frequency, v * 0.5, 2, seed) - 0.5) * amplitude;
    const i4 = (y * size + x) * 4;
    ctx.albedo.data[i4] = clamp255(ctx.albedo.data[i4] + streak * 255);
    ctx.albedo.data[i4 + 1] = clamp255(ctx.albedo.data[i4 + 1] + streak * 255);
    ctx.albedo.data[i4 + 2] = clamp255(ctx.albedo.data[i4 + 2] + streak * 255);
    ctx.height[y * size + x] += streak * 0.02;
  });
}

/** Per-panel tint jitter so a wall of identical panels doesn't look flat. */
function applyTintJitter(ctx: PaintContext, seed: number, amount: number): void {
  const jr = (hash2i(seed, 7, 13) - 0.5) * amount;
  const jg = (hash2i(seed, 19, 23) - 0.5) * amount;
  const jb = (hash2i(seed, 31, 41) - 0.5) * amount;
  forEachPixel(ctx.size, (x, y) => {
    const i4 = (y * ctx.size + x) * 4;
    ctx.albedo.data[i4] = clamp255(ctx.albedo.data[i4] + jr * 255);
    ctx.albedo.data[i4 + 1] = clamp255(ctx.albedo.data[i4 + 1] + jg * 255);
    ctx.albedo.data[i4 + 2] = clamp255(ctx.albedo.data[i4 + 2] + jb * 255);
  });
}

function basePaint(
  ctx: PaintContext,
  albedo: { r: number; g: number; b: number },
  ao: number,
  roughness: number,
  metallic: number,
  seed: number,
): void {
  forEachPixel(ctx.size, (x, y, u, v) => {
    // Micro-variation so flat surfaces have subtle life under specular highlights.
    const n = (fbm2(u * 8, v * 8, 2, seed) - 0.5) * 0.03;
    setMr(ctx, x, y, ao, clamp01(roughness + n * 0.5), metallic);
    const i4 = (y * ctx.size + x) * 4;
    const k = 1 + n;
    ctx.albedo.data[i4] = clamp255(albedo.r * 255 * k);
    ctx.albedo.data[i4 + 1] = clamp255(albedo.g * 255 * k);
    ctx.albedo.data[i4 + 2] = clamp255(albedo.b * 255 * k);
    ctx.albedo.data[i4 + 3] = 255;
  });
}

// ---------------------------------------------------------------------------
// Public generators — each returns { albedo, normal, metallicRoughness, emissive? }
// ---------------------------------------------------------------------------

/** White (portalable) or dark gunmetal (non-portalable) 2m wall panel. */
export function generateWallPanel(portalable: boolean, size: number, seed: number): GeneratedMaps {
  const ctx = new PaintContext(size, seed);
  if (portalable) {
    basePaint(ctx, { r: 0.86, g: 0.865, b: 0.885 }, 0.92, 0.5, 0, seed);
    applyTintJitter(ctx, seed, 0.015);
    paintSeam(ctx, 0.06, 0.22, 0.25);
    addMicroScratches(ctx, Math.round(size / 14), -10);
    addCornerGrime(ctx, seed, 0.5);
  } else {
    basePaint(ctx, { r: 0.165, g: 0.175, b: 0.195 }, 0.85, 0.45, 0.85, seed);
    addBrushedStreaks(ctx, seed + 5, 38, 0.08);
    paintSeam(ctx, 0.05, 0.3, 0.2);
    addMicroScratches(ctx, Math.round(size / 20), 8);
  }
  return finishMaps(ctx, false);
}

/** Darker scuffed floor panel with wear variation. */
export function generateFloor(size: number, seed: number): GeneratedMaps {
  const ctx = new PaintContext(size, seed);
  forEachPixel(size, (x, y, u, v) => {
    const wear = fbm2(u * 4, v * 4, 3, seed + 9);
    const rough = clamp01(0.34 + wear * 0.18);
    setMr(ctx, x, y, 0.8 - wear * 0.1, rough, 0.12);
    const base = 0.4 + (wear - 0.5) * 0.06;
    const i4 = (y * size + x) * 4;
    ctx.albedo.data[i4] = clamp255(base * 255);
    ctx.albedo.data[i4 + 1] = clamp255(base * 1.01 * 255);
    ctx.albedo.data[i4 + 2] = clamp255((base + 0.02) * 255);
    ctx.albedo.data[i4 + 3] = 255;
  });
  paintSeam(ctx, 0.05, 0.28, 0.22);
  addMicroScratches(ctx, Math.round(size / 10), -14);
  addCornerGrime(ctx, seed + 2, 0.35);
  return finishMaps(ctx, false);
}

/** Ceiling panel with a recessed light-housing pattern (pairs with fixtures). */
export function generateCeiling(size: number, seed: number): GeneratedMaps {
  const ctx = new PaintContext(size, seed);
  basePaint(ctx, { r: 0.82, g: 0.825, b: 0.84 }, 0.9, 0.5, 0, seed);
  // Recessed housing rectangle in the middle: lower height + slightly darker frame.
  const x0 = Math.round(size * 0.18);
  const y0 = Math.round(size * 0.18);
  const x1 = size - 1 - x0;
  const y1 = size - 1 - y0;
  const frame = Math.max(2, Math.round(size * 0.02));
  forEachPixel(size, (x, y) => {
    const inRecess = x >= x0 && x <= x1 && y >= y0 && y <= y1;
    if (!inRecess) return;
    const onFrame = x < x0 + frame || x > x1 - frame || y < y0 + frame || y > y1 - frame;
    const i = y * size + x;
    const i4 = i * 4;
    if (onFrame) {
      ctx.height[i] -= 0.05;
      ctx.albedo.data[i4] *= 0.85;
      ctx.albedo.data[i4 + 1] *= 0.85;
      ctx.albedo.data[i4 + 2] *= 0.85;
      ctx.mr.data[i4] = 0.7 * 255; // AO drop in the recess
    } else {
      // Inner housing: brighter (the fixture sits here), slightly smoother.
      ctx.albedo.data[i4] = clamp255(ctx.albedo.data[i4] * 1.05);
      ctx.albedo.data[i4 + 1] = clamp255(ctx.albedo.data[i4 + 1] * 1.05);
      ctx.albedo.data[i4 + 2] = clamp255(ctx.albedo.data[i4 + 2] * 1.05);
      ctx.mr.data[i4 + 1] = Math.min(255, ctx.mr.data[i4 + 1] + 8);
    }
  });
  paintSeam(ctx, 0.04, 0.2, 0.2);
  return finishMaps(ctx, false);
}

/** Brushed aluminum trim/frames. */
export function generateTrimMetal(size: number, seed: number): GeneratedMaps {
  const ctx = new PaintContext(size, seed);
  basePaint(ctx, { r: 0.72, g: 0.73, b: 0.75 }, 0.9, 0.35, 1, seed);
  addBrushedStreaks(ctx, seed + 3, 46, 0.07);
  addMicroScratches(ctx, Math.round(size / 18), 6);
  return finishMaps(ctx, false);
}

/** Near-black structural metal. */
export function generateDarkMetal(size: number, seed: number): GeneratedMaps {
  const ctx = new PaintContext(size, seed);
  basePaint(ctx, { r: 0.07, g: 0.07, b: 0.08 }, 0.88, 0.5, 0.9, seed);
  addBrushedStreaks(ctx, seed + 11, 30, 0.05);
  return finishMaps(ctx, false);
}

/** Glass: subtle tint + faint ripple normal; transparency handled by the material. */
export function generateGlass(size: number, seed: number): GeneratedMaps {
  const ctx = new PaintContext(size, seed);
  forEachPixel(size, (x, y, u, v) => {
    const ripple = fbm2(u * 5, v * 5, 3, seed + 7) - 0.5;
    ctx.height[y * size + x] = ripple * 0.04;
    setMr(ctx, x, y, 1, 0.06, 0);
    const i4 = (y * size + x) * 4;
    ctx.albedo.data[i4] = clamp255(0.72 * 255);
    ctx.albedo.data[i4 + 1] = clamp255(0.84 * 255);
    ctx.albedo.data[i4 + 2] = clamp255(0.92 * 255);
    ctx.albedo.data[i4 + 3] = 255;
  });
  return finishMaps(ctx, false);
}

/** White plastic cube shell with edge wear + Aperture-style circular logo. */
export function generateCubeShell(size: number, seed: number): GeneratedMaps {
  const ctx = new PaintContext(size, seed);
  basePaint(ctx, { r: 0.84, g: 0.84, b: 0.86 }, 0.92, 0.45, 0, seed);
  // Edge wear: darken + roughen the border.
  const edge = Math.max(2, Math.round(size * 0.04));
  forEachPixel(size, (x, y) => {
    const d = Math.min(x, y, size - 1 - x, size - 1 - y);
    if (d >= edge) return;
    const k = 1 - (edge - d) / edge;
    const i4 = (y * size + x) * 4;
    ctx.albedo.data[i4] *= 0.8 + k * 0.15;
    ctx.albedo.data[i4 + 1] *= 0.8 + k * 0.15;
    ctx.albedo.data[i4 + 2] *= 0.82 + k * 0.15;
    ctx.mr.data[i4 + 1] = Math.min(255, ctx.mr.data[i4 + 1] + (1 - k) * 40);
  });
  // Aperture-style logo: a circle outline with radial spokes (no font dependency).
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const radius = size * 0.26;
  const logo = rgba(70, 70, 74, 255);
  ctx.albedo.strokeCircle(cx, cy, radius, Math.max(1.5, size * 0.012), logo);
  const spokes = 8;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    ctx.albedo.strokeLine(
      cx + Math.cos(a) * radius * 0.35,
      cy + Math.sin(a) * radius * 0.35,
      cx + Math.cos(a) * radius * 0.92,
      cy + Math.sin(a) * radius * 0.92,
      Math.max(1, size * 0.006),
      logo,
    );
  }
  return finishMaps(ctx, false);
}

/** Dark button housing with a warm accent ring (the ring glows via emissive). */
export function generateButtonHousing(size: number, seed: number): GeneratedMaps {
  const ctx = new PaintContext(size, seed);
  basePaint(ctx, { r: 0.1, g: 0.1, b: 0.11 }, 0.85, 0.5, 0.6, seed);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const radius = size * 0.3;
  // Raised ring in albedo + height so the normal map picks it up.
  ctx.albedo.strokeCircle(cx, cy, radius, Math.max(2, size * 0.03), rgba(180, 110, 50, 255));
  forEachPixel(size, (x, y) => {
    const dist = Math.hypot(x - cx, y - cy);
    const ringDist = Math.abs(dist - radius);
    const onRing = Math.max(0, Math.min(1, size * 0.02 - ringDist));
    ctx.height[y * size + x] += onRing * 0.05;
    // Emissive mask: bright warm ring, black elsewhere.
    const e = onRing * 255;
    ctx.emissive.set(x, y, rgba(e, e * 0.62, e * 0.28, 255));
  });
  return finishMaps(ctx, true);
}

/**
 * Pick a texture resolution for a surface class at a quality tier. Hero
 * surfaces (cube shell, button housing) get 512px at high/ultra; 2m panels stay
 * 256px (~128px/m) for consistent texel density across tiers. Pure + tested.
 */
export function textureSizeFor(surface: 'panel' | 'hero', heroTextureSize: number, panelTextureSize: number): number {
  return surface === 'hero' ? heroTextureSize : panelTextureSize;
}