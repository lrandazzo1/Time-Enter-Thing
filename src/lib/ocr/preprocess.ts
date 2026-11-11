"use client";
import { chooseScale, enhance } from "./enhance";

export interface Prepared {
  canvas: HTMLCanvasElement;
  /** Factor applied to the original image (OCR coordinates are divided by this). */
  scale: number;
  width: number;
  height: number;
  inverted: boolean;
}

/**
 * Prepare a screenshot for OCR, in the browser only: upscale small screenshots (Tesseract reads
 * ~20–40 px text best), grayscale + contrast stretch, and invert dark-mode screenshots.
 */
export async function preprocessImage(file: Blob): Promise<Prepared> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  if (!width || !height) throw new Error("The image is empty.");
  const src = document.createElement("canvas");
  src.width = width;
  src.height = height;
  const sctx = src.getContext("2d", { willReadFrequently: true });
  if (!sctx) throw new Error("This browser can't process images (canvas unavailable).");
  sctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const scale = chooseScale(width, height);
  const res = enhance(sctx.getImageData(0, 0, width, height), scale);
  src.width = src.height = 0;
  const canvas = document.createElement("canvas");
  canvas.width = res.width;
  canvas.height = res.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(res.data as Uint8ClampedArray<ArrayBuffer>, res.width, res.height), 0, 0);
  return { canvas, scale, width, height, inverted: res.inverted };
}

/** Same preparation for an already-drawn canvas (e.g. a rendered PDF page). The input is not modified. */
export function preprocessCanvas(src: HTMLCanvasElement): Prepared {
  const { width, height } = src;
  if (!width || !height) throw new Error("The page image is empty.");
  const sctx = src.getContext("2d", { willReadFrequently: true });
  if (!sctx) throw new Error("This browser can't process images (canvas unavailable).");
  const scale = chooseScale(width, height);
  const res = enhance(sctx.getImageData(0, 0, width, height), scale);
  const canvas = document.createElement("canvas");
  canvas.width = res.width;
  canvas.height = res.height;
  canvas.getContext("2d")!.putImageData(new ImageData(res.data as Uint8ClampedArray<ArrayBuffer>, res.width, res.height), 0, 0);
  return { canvas, scale, width, height, inverted: res.inverted };
}

