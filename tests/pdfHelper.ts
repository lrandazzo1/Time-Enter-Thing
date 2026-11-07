import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfPageText } from "@/lib/pdf/agenda";

/** Node equivalent of src/lib/pdf/extract.ts (same item conversion), for tests. */
export async function pdfPages(file: string | Uint8Array): Promise<PdfPageText[]> {
  const data = typeof file === "string" ? new Uint8Array(readFileSync(file)) : file;
  const task = getDocument({ data, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
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
  }
  await task.destroy();
  return pages;
}
