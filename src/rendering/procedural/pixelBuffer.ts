/**
 * rendering/procedural/pixelBuffer.ts — Minimal anti-aliased RGBA rasterizer.
 *
 * Canvas 2D is unavailable in the node test environment, so every procedural
 * texture is painted into plain Uint8ClampedArray buffers via this class and
 * uploaded with RawTexture. Strokes use distance-based coverage so lines and
 * circles are anti-aliased without a canvas.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function rgba(r: number, g: number, b: number, a = 255): Rgba {
  return { r, g, b, a };
}

export class PixelBuffer {
  readonly data: Uint8ClampedArray;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  /** Overwrite a pixel (clamped to bounds). */
  set(x: number, y: number, color: Rgba): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = color.r;
    this.data[i + 1] = color.g;
    this.data[i + 2] = color.b;
    this.data[i + 3] = color.a;
  }

  /** Source-over blend with coverage in [0, 1] scaling the source alpha. */
  blend(x: number, y: number, color: Rgba, coverage = 1): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || coverage <= 0) return;
    const i = (y * this.width + x) * 4;
    const srcA = (color.a / 255) * Math.min(1, coverage);
    const dstA = this.data[i + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;
    this.data[i] = (color.r * srcA + this.data[i] * dstA * (1 - srcA)) / outA;
    this.data[i + 1] = (color.g * srcA + this.data[i + 1] * dstA * (1 - srcA)) / outA;
    this.data[i + 2] = (color.b * srcA + this.data[i + 2] * dstA * (1 - srcA)) / outA;
    this.data[i + 3] = outA * 255;
  }

  fill(color: Rgba): void {
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = color.r;
      this.data[i + 1] = color.g;
      this.data[i + 2] = color.b;
      this.data[i + 3] = color.a;
    }
  }

  fillRect(x0: number, y0: number, w: number, h: number, color: Rgba): void {
    const x1 = Math.min(this.width, Math.max(0, Math.round(x0 + w)));
    const y1 = Math.min(this.height, Math.max(0, Math.round(y0 + h)));
    for (let y = Math.max(0, Math.round(y0)); y < y1; y++) {
      for (let x = Math.max(0, Math.round(x0)); x < x1; x++) {
        this.blend(x, y, color);
      }
    }
  }

  /**
   * Anti-aliased thick line via distance-to-segment coverage. Pixels within
   * half the thickness are fully covered; one extra pixel feathers the edge.
   */
  strokeLine(x0: number, y0: number, x1: number, y1: number, thickness: number, color: Rgba): void {
    const radius = thickness / 2;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - radius - 1));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(x0, x1) + radius + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - radius - 1));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(y0, y1) + radius + 1));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSq = dx * dx + dy * dy;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / lengthSq)) : 0;
        const px = x0 + t * dx;
        const py = y0 + t * dy;
        const dist = Math.hypot(x - px, y - py);
        const coverage = Math.max(0, Math.min(1, radius + 0.5 - dist));
        if (coverage > 0) this.blend(x, y, color, coverage);
      }
    }
  }

  fillCircle(cx: number, cy: number, radius: number, color: Rgba): void {
    const minX = Math.max(0, Math.floor(cx - radius - 1));
    const maxX = Math.min(this.width - 1, Math.ceil(cx + radius + 1));
    const minY = Math.max(0, Math.floor(cy - radius - 1));
    const maxY = Math.min(this.height - 1, Math.ceil(cy + radius + 1));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dist = Math.hypot(x - cx, y - cy);
        const coverage = Math.max(0, Math.min(1, radius + 0.5 - dist));
        if (coverage > 0) this.blend(x, y, color, coverage);
      }
    }
  }

  strokeCircle(cx: number, cy: number, radius: number, thickness: number, color: Rgba): void {
    const half = thickness / 2;
    const outer = radius + half + 1;
    const minX = Math.max(0, Math.floor(cx - outer));
    const maxX = Math.min(this.width - 1, Math.ceil(cx + outer));
    const minY = Math.max(0, Math.floor(cy - outer));
    const maxY = Math.min(this.height - 1, Math.ceil(cy + outer));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dist = Math.abs(Math.hypot(x - cx, y - cy) - radius);
        const coverage = Math.max(0, Math.min(1, half + 0.5 - dist));
        if (coverage > 0) this.blend(x, y, color, coverage);
      }
    }
  }
}
