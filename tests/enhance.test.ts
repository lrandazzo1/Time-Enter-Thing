import { describe, expect, it } from "vitest";
import { enhance } from "@/lib/ocr/enhance";

describe("OCR image enhancement", () => {
  it("keeps text visible on a mostly blank page (>99% background)", () => {
    const W = 200, H = 200;
    const data = new Uint8ClampedArray(W * H * 4).fill(255);
    for (let x = 10; x < 60; x++) for (let y = 10; y < 14; y++) data.set([20, 20, 20, 255], (y * W + x) * 4); // 0.5% dark "text"
    const out = enhance({ data, width: W, height: H }, 1);
    const at = (x: number, y: number) => out.data[(y * W + x) * 4];
    expect(at(30, 12)).toBeLessThan(80); // text stays dark
    expect(at(150, 150)).toBeGreaterThan(200); // background stays light
  });
  it("still stretches contrast on a normal page", () => {
    const W = 100, H = 100;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let p = 0; p < W * H; p++) data.set(p % 3 === 0 ? [90, 90, 90, 255] : [200, 200, 200, 255], p * 4);
    const out = enhance({ data, width: W, height: H }, 1);
    expect(out.data[0]).toBe(0);
    expect(out.data[4]).toBe(255);
  });
});
