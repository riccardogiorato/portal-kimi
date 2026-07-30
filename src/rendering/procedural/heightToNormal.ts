/**
 * rendering/procedural/heightToNormal.ts — Sobel height-field → tangent-space
 * normal map. Sampling wraps at the edges so generated textures tile
 * seamlessly across panel grids. Pure and allocation-light: one output
 * buffer per call, invoked only at material build time.
 *
 * Encoding: n.xyz ∈ [-1,1] → rgb = (n * 0.5 + 0.5) * 255, OpenGL convention
 * (+Y up), which is what Babylon's PBR bump pipeline expects by default.
 */
export function heightToNormal(
  height: ArrayLike<number>,
  width: number,
  heightPx: number,
  strength: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * heightPx * 4);
  const at = (x: number, y: number): number => {
    const wx = ((x % width) + width) % width;
    const wy = ((y % heightPx) + heightPx) % heightPx;
    return height[wy * width + wx];
  };
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < width; x++) {
      // Sobel gradients: left column minus right column, top minus bottom.
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
      const nx = dx * strength;
      const ny = dy * strength;
      const invLen = 1 / Math.hypot(nx, ny, 1);
      const i = (y * width + x) * 4;
      out[i] = (nx * invLen * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * invLen * 0.5 + 0.5) * 255;
      out[i + 2] = (invLen * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}
