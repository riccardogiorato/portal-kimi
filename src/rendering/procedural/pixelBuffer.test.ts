/**
 * PixelBuffer — anti-aliased rasterizer over typed arrays (no canvas).
 */
import { describe, expect, it } from 'vitest';
import { PixelBuffer, rgba } from './pixelBuffer';

describe('PixelBuffer', () => {
  it('set writes the exact pixel and is bounds-clamped', () => {
    const pb = new PixelBuffer(2, 2);
    pb.set(0, 0, rgba(10, 20, 30, 255));
    expect(pb.data[0]).toBe(10);
    expect(pb.data[1]).toBe(20);
    expect(pb.data[2]).toBe(30);
    expect(pb.data[3]).toBe(255);
    pb.set(-1, 0, rgba(1, 1, 1, 1)); // out of bounds — no-op
    expect(pb.data[0]).toBe(10);
  });

  it('fill overwrites every pixel', () => {
    const pb = new PixelBuffer(3, 2);
    pb.fill(rgba(5, 6, 7, 255));
    for (let i = 0; i < pb.data.length; i += 4) {
      expect(pb.data[i]).toBe(5);
      expect(pb.data[i + 3]).toBe(255);
    }
  });

  it('blend composites a semi-transparent source over an opaque dest', () => {
    const pb = new PixelBuffer(1, 1);
    pb.set(0, 0, rgba(0, 0, 0, 255));
    pb.blend(0, 0, rgba(255, 255, 255, 255), 0.5);
    // 50% white over black ~ 127
    expect(pb.data[0]).toBeGreaterThan(120);
    expect(pb.data[0]).toBeLessThan(135);
  });

  it('fillRect paints a rectangular region', () => {
    const pb = new PixelBuffer(4, 4);
    pb.fillRect(1, 1, 2, 2, rgba(255, 0, 0, 255));
    expect(pb.data[(1 * 4 + 1) * 4]).toBe(255); // inside
    expect(pb.data[(0 * 4 + 0) * 4]).toBe(0); // outside
  });

  it('strokeLine draws pixels near the segment', () => {
    const pb = new PixelBuffer(8, 8);
    pb.strokeLine(1, 1, 6, 1, 1.5, rgba(255, 255, 255, 255));
    // The midpoint of the horizontal line should be covered.
    let covered = 0;
    for (let x = 0; x < 8; x++) {
      if (pb.data[(1 * 8 + x) * 4] > 0) covered++;
    }
    expect(covered).toBeGreaterThan(0);
  });

  it('fillCircle paints a centered blob', () => {
    const pb = new PixelBuffer(8, 8);
    pb.fillCircle(4, 4, 3, rgba(255, 255, 255, 255));
    expect(pb.data[(4 * 8 + 4) * 4]).toBe(255); // center
    expect(pb.data[(0 * 8 + 0) * 4]).toBe(0); // corner
  });
});