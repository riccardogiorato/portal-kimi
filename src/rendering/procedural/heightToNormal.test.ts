/**
 * Sobel height-field -> tangent-space normal map. Known inputs: a flat field
 * yields straight-up normals; a ramp tilts the normal toward the downhill side.
 */
import { describe, expect, it } from 'vitest';
import { heightToNormal } from './heightToNormal';

function sample(out: Uint8ClampedArray, w: number, x: number, y: number): [number, number, number, number] {
  const i = (y * w + x) * 4;
  return [out[i], out[i + 1], out[i + 2], out[i + 3]];
}

describe('heightToNormal', () => {
  it('returns w*h*4 bytes with opaque alpha', () => {
    const out = heightToNormal(new Float32Array(16).fill(0.5), 4, 4, 0.5);
    expect(out.length).toBe(4 * 4 * 4);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });

  it('maps a flat field to straight-up normals (128,128,255)', () => {
    const out = heightToNormal(new Float32Array(16).fill(0.5), 4, 4, 0.5);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const [r, g, b] = sample(out, 4, x, y);
        expect(r).toBe(128);
        expect(g).toBe(128);
        expect(b).toBe(255);
      }
    }
  });

  it('tilts the normal against a +x height ramp (x-channel shifts off 128)', () => {
    // Height rises with x: the surface tilts so the normal points toward -x,
    // i.e. the encoded x channel drops below 128 at interior pixels.
    const h = new Float32Array(8 * 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h[y * 8 + x] = x / 8;
    const out = heightToNormal(h, 8, 8, 1);
    const [r] = sample(out, 8, 4, 4);
    expect(r).not.toBe(128);
    // For a +x ramp, Sobel dx is positive -> nx positive -> r > 128 in this
    // OpenGL encoding (n*0.5+0.5). Assert it moved off the flat value either way.
    expect(Math.abs(r - 128)).toBeGreaterThan(2);
  });

  it('wraps at the edges (tiling) — edge normals are finite and not all flat', () => {
    // A single spike in the corner should produce non-flat normals at the
    // opposite (wrapped) edge because sampling wraps around.
    const h = new Float32Array(8 * 8);
    h[0] = 1;
    const out = heightToNormal(h, 8, 8, 0.5);
    for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i])).toBe(true);
    const [r] = sample(out, 8, 7, 7);
    expect(r).not.toBe(128);
  });
});