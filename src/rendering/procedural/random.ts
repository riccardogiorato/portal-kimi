/**
 * rendering/procedural/random.ts — Deterministic pseudo-random sources.
 *
 * Every procedural texture in the rendering stack is seeded so frames,
 * chambers and quality tiers produce identical output run-to-run (required
 * for reproducible visuals and unit tests). No Math.random anywhere.
 */

/** mulberry32: tiny fast PRNG with a 2^32 period. Returns values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic 2D integer lattice hash → [0, 1). Used for value noise and
 * per-feature jitter. Math.imul keeps everything in 32-bit integer land so
 * results are identical across engines.
 */
export function hash2i(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep01(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Smooth value noise on a unit lattice, output in [0, 1]. */
export function valueNoise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smoothstep01(x - xi);
  const yf = smoothstep01(y - yi);
  const c00 = hash2i(xi, yi, seed);
  const c10 = hash2i(xi + 1, yi, seed);
  const c01 = hash2i(xi, yi + 1, seed);
  const c11 = hash2i(xi + 1, yi + 1, seed);
  const top = c00 + (c10 - c00) * xf;
  const bottom = c01 + (c11 - c01) * xf;
  return top + (bottom - top) * yf;
}

/**
 * Fractal Brownian motion: `octaves` of value noise, frequency doubling and
 * amplitude halving per octave, normalized back to [0, 1].
 */
export function fbm2(x: number, y: number, octaves: number, seed: number): number {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise2(x * frequency, y * frequency, seed + i * 101);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}
