"use client";
import { AgendaError, textStats, type PdfPageText, type TextStats } from "./agenda";

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
  stage: "render" | "ocr";
  page: number;
  total: number;
  status: string;
  progress: number;
}

/** Pages read with text recognition at most (each takes several seconds). */
export const OCR_MAX_PAGES = 20;

/**
 * Fallback for PDFs without usable text: render each page to an image in this browser and read it with
 * the self-hosted Tesseract.js engine (already used for project screenshots). Nothing is uploaded.
 * The result has the same shape as extractPdfText so the same parser runs on it, in OCR mode.
 */
export async function ocrPdf(file: Blob, onProgress?: (p: OcrPdfProgress) => void): Promise<ExtractResult & { truncated: boolean }> {
  const { task, doc } = await openPdf(file);
  const scale = 2.5; // ≈180 dpi: body text ends up ~25 px tall, which Tesseract reads well
  const images: File[] = [];
  const sizes: { width: number; height: number }[] = [];
  const n = Math.min(doc.numPages, OCR_MAX_PAGES);
  try {
    for (let p = 1; p <= n; p++) {
      onProgress?.({ stage: "render", page: p, total: n, status: `Rendering page ${p} of ${n}…`, progress: 0 });
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp, canvas } as Parameters<typeof page.render>[0]).promise;
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("render failed"))), "image/png"));
      images.push(new File([blob], `page-${p}.png`, { type: "image/png" }));
      sizes.push({ width: canvas.width, height: canvas.height });
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  } catch (e) {
    if (e instanceof AgendaError) throw e;
    throw new AgendaError("unreadable", "The PDF pages couldn't be rendered for text recognition.", undefined, "PDF_RENDER");
  } finally {
    await task.destroy();
  }
  const { ocrImages } = await import("../ocr/ocr");
  const ocr = await ocrImages(images, {
    mode: "document",
    onProgress: (p) => onProgress?.({ stage: "ocr", page: p.index + 1, total: images.length, status: `Reading page ${p.index + 1} of ${images.length}: ${p.status}`, progress: p.progress }),
  });
  const pages = ocrToPdfPages(ocr.map((o, i) => ({ ...o, width: sizes[i].width, height: sizes[i].height })));
  return { pages, stats: textStats(pages), truncated: doc.numPages > n };
}

/** OCR lines → positioned items (y flipped to PDF orientation; size from the line height). */
export function ocrToPdfPages(ocr: { width: number; height: number; lines: { text: string; confidence: number; x0: number; y0: number; x1: number; y1: number }[] }[]): PdfPageText[] {
  return ocr.map((o, i) => ({
    page: i + 1,
    width: o.width,
    height: o.height,
    items: o.lines.map((l) => ({ str: l.text, x: l.x0, y: o.height - l.y1, width: l.x1 - l.x0, size: Math.max(1, (l.y1 - l.y0) * 0.8), font: "ocr", conf: l.confidence })),
  }));
}
