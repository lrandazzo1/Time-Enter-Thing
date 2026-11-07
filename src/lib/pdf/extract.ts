"use client";
import { AgendaError, NO_TEXT_MESSAGE, type PdfPageText } from "./agenda";

/**
 * Extract positioned text from a PDF in the browser with pdf.js. The worker script is served from
 * this site's own /pdfjs/ folder (copied at build time) — the PDF never leaves the device.
 * Only text is read: no scripts, forms, attachments or fonts are executed or rendered.
 */
export async function extractPdfText(file: Blob, onProgress?: (page: number, total: number) => void): Promise<PdfPageText[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/pdfjs/pdf.worker.min.mjs`;
  let doc;
  const task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      enableXfa: false,
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: false,
      standardFontDataUrl: `${window.location.origin}/pdfjs/standard_fonts/`,
    });
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => {});
    const name = (e as Error).name;
    if (name === "PasswordException") throw new AgendaError("unreadable", "This PDF is password-protected. Export it from Outlook again without a password.");
    throw new AgendaError("unreadable", "This file couldn't be opened as a PDF. Export your calendar from Outlook again (Print → Detailed agenda → Save as PDF).");
  }
  try {
    if (doc.numPages > 300) throw new AgendaError("unreadable", "This PDF has more than 300 pages. Print a shorter date range (one week is ideal).");
    const pages: PdfPageText[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
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
      onProgress?.(p, doc.numPages);
    }
    if (pages.every((p) => p.items.every((i) => !i.str.trim()))) throw new AgendaError("no-text", NO_TEXT_MESSAGE);
    return pages;
  } finally {
    await task.destroy();
  }
}
