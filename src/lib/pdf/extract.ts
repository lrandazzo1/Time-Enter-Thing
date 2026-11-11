"use client";
import { AgendaError, textStats, type PdfPageText, type TextStats } from "./agenda";
import { missingPages, newOcrState, runSequential, type OcrPagesState } from "./ocrRun";
import type { OcrWorker } from "../ocr/ocr";

/**
 * Extract positioned text from a PDF in the browser with pdf.js. The worker script is served from
 * this site's own /pdfjs/ folder (copied at build time) — the PDF never leaves the device.
 * Only text is read: no scripts, forms or attachments are executed.
 *
 * Failures are reported as AgendaError("unreadable", …, category) with a technical category that is safe
 * to show (PDF_PASSWORD, PDF_INVALID, PDF_WORKER, PDF_PAGE_TEXT, PDF_TOO_LARGE, PDF_UNKNOWN).
 */

const MAX_PAGES = 300;

async function openPdf(file: Blob) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/pdfjs/pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    standardFontDataUrl: `${window.location.origin}/pdfjs/standard_fonts/`,
  });
  try {
    return { task, doc: await task.promise };
  } catch (e) {
    await task.destroy().catch(() => {});
    const err = e as Error;
    const name = err?.name ?? "";
    const msg = String(err?.message ?? "");
    if (name === "PasswordException") throw new AgendaError("unreadable", "This PDF is password-protected. Export it from Outlook again without a password.", undefined, "PDF_PASSWORD");
    if (/worker/i.test(msg) || /worker/i.test(name)) throw new AgendaError("unreadable", "The PDF reader couldn't start in this browser. Reload the page and try again; if it keeps failing, try another browser.", undefined, "PDF_WORKER");
    if (name === "InvalidPDFException" || /invalid pdf|unexpected|bad xref|missing pdf/i.test(msg))
      throw new AgendaError("unreadable", "This file couldn't be opened as a PDF (it may be damaged or not really a PDF). Save the calendar from Outlook again.", undefined, "PDF_INVALID");
    throw new AgendaError("unreadable", `This PDF couldn't be opened (${name || "error"}).`, undefined, "PDF_UNKNOWN");
  }
}

export interface ExtractResult {
  pages: PdfPageText[];
  stats: TextStats;
}

export async function extractPdfText(file: Blob, onProgress?: (page: number, total: number) => void): Promise<ExtractResult> {
  const { task, doc } = await openPdf(file);
  try {
    if (doc.numPages > MAX_PAGES) throw new AgendaError("unreadable", `This PDF has more than ${MAX_PAGES} pages. Print a shorter date range (one week is ideal).`, undefined, "PDF_TOO_LARGE");
    let producer: string | undefined;
    let creator: string | undefined;
    try {
      const md = await doc.getMetadata();
      const info = md.info as { Producer?: string; Creator?: string };
      // Only the generating software is kept (never Title/Author, which can contain names).
      producer = info.Producer?.slice(0, 80);
      creator = info.Creator?.replace(/\(.*?\)/g, "").slice(0, 80);
    } catch {
      /* metadata is optional */
    }
    const pages: PdfPageText[] = [];
    let pageErrors = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      try {
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        const items = [];
        for (const it of tc.items) {
          if (!("str" in it)) continue;
          const [a, b, , , x, y] = it.transform as number[];
          items.push({ str: it.str, x, y, width: it.width, size: Math.hypot(a, b) || it.height, font: it.fontName });
        }
        pages.push({ page: p, width: vp.width, height: vp.height, items });
        page.cleanup();
      } catch {
        pageErrors++;
        pages.push({ page: p, width: 612, height: 792, items: [] });
      }
      onProgress?.(p, doc.numPages);
    }
    if (pageErrors === doc.numPages) throw new AgendaError("unreadable", "The text of this PDF couldn't be read on any page.", undefined, "PDF_PAGE_TEXT");
    return { pages, stats: textStats(pages, { producer, creator, pageErrors: pageErrors || undefined }) };
  } finally {
    await task.destroy();
  }
}

export interface OcrPdfProgress {
  /** PDF page being processed (1-based) and the PDF's page count. */
  page: number;
  total: number;
  /** Position within this run (a retry may process only some pages). */
  index: number;
  count: number;
  status: string;
  /** 0–1 within the current page. */
  progress: number;
}

/** Longest edge budget for a rendered page: ~180 dpi for Letter/A4, scaled down for very large pages. */
const RENDER_SCALE = 2.5;
const MAX_PIXELS = 6_000_000;

export const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

/**
 * Text recognition for PDFs without usable text, one page at a time with no page limit: render a page
 * with pdf.js, read it with the self-hosted Tesseract.js worker, release the canvas, move on. Nothing is
 * uploaded. Pass an existing `state` and `pages` to retry only the pages still missing.
 */
export async function ocrPdfPages(
  file: File,
  opts: { state?: OcrPagesState; pages?: number[]; signal?: AbortSignal; onProgress?: (p: OcrPdfProgress) => void; onPageDone?: (state: OcrPagesState, page: number, ok: boolean) => void },
): Promise<{ state: OcrPagesState; cancelled: boolean }> {
  const { task, doc } = await openPdf(file);
  const total = doc.numPages;
  const state = opts.state && opts.state.total === total ? opts.state : newOcrState(fileKey(file), total);
  const pages = opts.pages ?? missingPages(state);
  const { createOcrWorker } = await import("../ocr/ocr");
  let current = { page: pages[0] ?? 1, index: 0 };
  const report = (status: string, progress: number) => opts.onProgress?.({ page: current.page, total, index: current.index, count: pages.length, status, progress });
  let worker: OcrWorker | null = null;
  const getWorker = async () => (worker ??= await createOcrWorker("document", (st, pr) => report(st, pr)));
  try {
    const result = await runSequential(state, {
      pages,
      signal: opts.signal,
      timeoutMs: 180_000,
      onStart: (page, index) => {
        current = { page, index };
        report(`Processing page ${page} of ${total}`, 0);
      },
      onPage: (page, ok) => {
        opts.onPageDone?.(state, page, ok);
      },
      process: async (pageNo, signal) => {
        const w = await getWorker();
        // A cancel or timeout stops the engine mid-page; a fresh one is started for the next page.
        const stop = () => {
          worker = null;
          void w.terminate();
        };
        signal.addEventListener("abort", stop, { once: true });
        const page = await doc.getPage(pageNo);
        const canvas = document.createElement("canvas");
        try {
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(RENDER_SCALE, Math.sqrt(MAX_PIXELS / (base.width * base.height)));
          const vp = page.getViewport({ scale });
          canvas.width = Math.ceil(vp.width);
          canvas.height = Math.ceil(vp.height);
          const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: vp, canvas } as Parameters<typeof page.render>[0]).promise;
          if (signal.aborted) throw new Error("aborted");
          const ocr = await w.recognizeCanvas(canvas, `page ${pageNo}`);
          return ocrPageToPdfPage({ ...ocr, width: canvas.width, height: canvas.height }, pageNo);
        } finally {
          signal.removeEventListener("abort", stop);
          canvas.width = canvas.height = 0; // release the page bitmap
          page.cleanup();
        }
      },
    });
    return { state, cancelled: result.cancelled };
  } finally {
    const w = worker as OcrWorker | null;
    if (w) await w.terminate();
    await task.destroy();
  }
}

type OcrLineLike = { text: string; confidence: number; x0: number; y0: number; x1: number; y1: number; words?: { text: string; x0: number; x1: number }[] };

/**
 * Outlook prints a small coloured category square left of each meeting title; text recognition reads it
 * as junk ("Hl", "HB", "#", "%"). Titles and body text share one left margin (the most common line start),
 * so short leading "words" that end before that margin are dropped. Day headings, which start further
 * left, are long words and are kept.
 */
function dropMarginIcons(lines: OcrLineLike[]): OcrLineLike[] {
  if (lines.length < 4) return lines;
  const starts = lines.map((l) => Math.round(l.x0 / 4) * 4);
  const counts = new Map<number, number>();
  for (const x of starts) counts.set(x, (counts.get(x) ?? 0) + 1);
  const margin = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  return lines.map((l) => {
    const h = l.y1 - l.y0;
    if (!l.words?.length || l.x0 > margin - h * 0.5) return l;
    const words = [...l.words];
    while (words.length > 1 && words[0].text.length <= 3 && !/\d/.test(words[0].text) && words[0].x1 < margin + h * 0.3) words.shift();
    if (words.length === l.words.length) return l;
    return { ...l, text: words.map((w) => w.text).join(" "), x0: words[0].x0, words };
  });
}

/** One OCR'd page → positioned items (y flipped to PDF orientation; size from the line height). */
export function ocrPageToPdfPage(o: { width: number; height: number; lines: OcrLineLike[] }, page: number): PdfPageText {
  return {
    page,
    width: o.width,
    height: o.height,
    items: dropMarginIcons(o.lines).map((l) => ({ str: l.text, x: l.x0, y: o.height - l.y1, width: l.x1 - l.x0, size: Math.max(1, (l.y1 - l.y0) * 0.8), font: "ocr", conf: l.confidence })),
  };
}

/** OCR lines → positioned items (y flipped to PDF orientation; size from the line height). */
export function ocrToPdfPages(ocr: { width: number; height: number; lines: OcrLineLike[] }[]): PdfPageText[] {
  return ocr.map((o, i) => ocrPageToPdfPage(o, i + 1));
}
