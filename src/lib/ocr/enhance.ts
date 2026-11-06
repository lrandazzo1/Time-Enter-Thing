/**
 * Pure image enhancement for OCR (no DOM): bilinear upscale, grayscale, 1–99% contrast stretch,
 * and inversion of dark-mode images. Shared by the browser pipeline and the Node OCR tests.
 */
export interface Rgba {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export function chooseScale(width: number, height: number): number {
  let scale = 1;
  if (width < 1500) scale = Math.min(3, 2200 / width);
  if (width * scale > 4200) scale = 4200 / width;
  if (height * scale > 12000) scale = Math.min(scale, 12000 / height);
  return scale;
}

export function enhance(src: Rgba, scale: number): Rgba & { inverted: boolean } {
  const W = Math.max(1, Math.round(src.width * scale));
  const H = Math.max(1, Math.round(src.height * scale));
  const s = src.data;
  // grayscale at source resolution (alpha composited on white)
  const g = new Float32Array(src.width * src.height);
  for (let i = 0, p = 0; p < g.length; i += 4, p++) {
    const a = s[i + 3] / 255;
    const lum = (s[i] * 299 + s[i + 1] * 587 + s[i + 2] * 114) / 1000;
    g[p] = lum * a + 255 * (1 - a);
  }
  const out = new Uint8ClampedArray(W * H * 4);
  const gray = new Float32Array(W * H);
  const hist = new Uint32Array(256);
  let sum = 0;
  for (let y = 0; y < H; y++) {
    const sy = Math.min(src.height - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = Math.min(src.width - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(src.width - 1, x0 + 1);
      const fx = sx - x0;
      const v =
        g[y0 * src.width + x0] * (1 - fx) * (1 - fy) +
        g[y0 * src.width + x1] * fx * (1 - fy) +
        g[y1 * src.width + x0] * (1 - fx) * fy +
        g[y1 * src.width + x1] * fx * fy;
      gray[y * W + x] = v;
      hist[v | 0]++;
      sum += v;
    }
  }
  const n = W * H;
  const inverted = sum / n < 110;
  const pct = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= n * q) return v;
    }
    return 255;
  };
  const lo = pct(0.01);
  const hi = Math.max(lo + 1, pct(0.99));
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    let v = ((gray[p] - lo) * 255) / (hi - lo);
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    if (inverted) v = 255 - v;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return { data: out, width: W, height: H, inverted };
}
