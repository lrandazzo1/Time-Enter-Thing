/**
 * Optional check: an Outlook agenda PDF with no selectable text, read page by page with text recognition
 * in Node (pdf.js rendering + Tesseract.js), exactly like the browser pipeline. The PDF is NOT stored here.
 * Run with: OCR_PDF=/path/to/agenda.pdf npx vitest run tests/ocr-pdf.private.test.ts
 * Only counts and page numbers are printed — no meeting content.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker, OEM, PSM } from "tesseract.js";
import { PNG } from "pngjs";
import { fromTesseract } from "@/lib/ocr/types";
import { chooseScale, enhance } from "@/lib/ocr/enhance";
import { parseAgenda, textStats } from "@/lib/pdf/agenda";
import { ocrPageToPdfPage } from "@/lib/pdf/extract";
import { missingPages, newOcrState, readPages, runSequential } from "@/lib/pdf/ocrRun";
import { eventToEntry } from "@/lib/matching";
import { findOverlaps } from "@/lib/review";
import { settings } from "./helpers";

const file = process.env.OCR_PDF ?? "";
describe.skipIf(!file || !existsSync(file))("image-only Outlook agenda PDF read with text recognition (local only)", () => {
  it("reads every page, including the ones after page 20", async () => {
    const task = getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 });
    const doc = await task.promise;
    const worker = await createWorker("eng", OEM.LSTM_ONLY, { langPath: path.resolve("node_modules/@tesseract.js-data/eng/4.0.0_best_int"), gzip: true, cacheMethod: "none" });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1", user_defined_dpi: "300" });
    const state = newOcrState("private", doc.numPages);
    const t0 = Date.now();
    const res = await runSequential(state, {
      pages: missingPages(state),
      timeoutMs: 300_000,
      process: async (n) => {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(2.5, Math.sqrt(6_000_000 / (base.width * base.height))) });
        const factory = (doc as unknown as { canvasFactory: { create(w: number, h: number): { canvas: unknown; context: CanvasRenderingContext2D }; destroy(c: unknown): void } }).canvasFactory;
        const cc = factory.create(Math.ceil(vp.width), Math.ceil(vp.height));
        cc.context.fillStyle = "#fff";
        cc.context.fillRect(0, 0, Math.ceil(vp.width), Math.ceil(vp.height));
        await page.render({ canvasContext: cc.context, viewport: vp } as Parameters<typeof page.render>[0]).promise;
        const w = Math.ceil(vp.width);
        const h = Math.ceil(vp.height);
        const img = cc.context.getImageData(0, 0, w, h);
        factory.destroy(cc);
        page.cleanup();
        const scale = chooseScale(w, h);
        const e = enhance({ data: img.data, width: w, height: h }, scale);
        const png = new PNG({ width: e.width, height: e.height });
        png.data = Buffer.from(e.data);
        const { data } = await worker.recognize(PNG.sync.write(png), {}, { blocks: true, text: true });
        return ocrPageToPdfPage({ ...fromTesseract(`page ${n}`, data, w, h, scale), width: w, height: h }, n);
      },
    });
    await worker.terminate();
    await task.destroy();
    const pages = readPages(state);
    const r = parseAgenda(pages, { ocr: true, stats: textStats(pages) });
    const timed = r.events.filter((e) => !e.allDay);
    const byPage = (lo: number, hi: number) => timed.filter((e) => {
      const p = Number(/page (\d+)/.exec(e.sourceLabel ?? "")?.[1]);
      return p >= lo && p <= hi;
    }).length;
    const entries = r.events.map((e) => eventToEntry(e, [], settings, []));
    console.log(JSON.stringify({
      pages: state.total, read: pages.length, failed: Object.keys(state.failed), seconds: Math.round((Date.now() - t0) / 1000),
      timed: timed.length, allDay: r.events.length - timed.length, canceled: r.events.filter((e) => e.canceled).length,
      pages1to20: byPage(1, 20), pages21to28: byPage(21, 28), rejected: r.rejected.length, rejections: r.diagnostics.rejections,
      untitled: timed.filter((e) => /title not found/.test(e.title)).length, overlaps: findOverlaps(entries).length,
      duplicateKeys: timed.length - new Set(timed.map((e) => `${e.title}|${e.date}|${e.start}`)).size,
      confidence: r.diagnostics.ocr?.meanConfidence,
    }));
    expect(res.cancelled).toBe(false);
    expect(missingPages(state)).toEqual([]);
    expect(pages).toHaveLength(doc.numPages);
    expect(byPage(21, doc.numPages)).toBeGreaterThan(0);
    expect(timed.every((e) => e.parseNotes?.some((n) => n.code === "pdf-check"))).toBe(true);
  }, 900_000);
});
