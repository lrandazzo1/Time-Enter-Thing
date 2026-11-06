/** Engine-independent OCR output used by the parsers. */
export interface OcrLine {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrPage {
  label: string;
  width: number;
  height: number;
  lines: OcrLine[];
  text: string;
  confidence: number;
}

interface TessLike {
  text?: string;
  confidence?: number;
  blocks?: { paragraphs: { lines: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] | null;
}

/** Convert a Tesseract.js page result to OcrPage (coordinates divided by `scale` to match the original image). */
export function fromTesseract(label: string, data: TessLike, width: number, height: number, scale = 1): OcrPage {
  const lines: OcrLine[] = [];
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs) {
      for (const l of p.lines) {
        const text = l.text.replace(/\s+$/g, "").replace(/\n/g, " ");
        if (!text.trim()) continue;
        lines.push({ text, confidence: l.confidence, x0: l.bbox.x0 / scale, y0: l.bbox.y0 / scale, x1: l.bbox.x1 / scale, y1: l.bbox.y1 / scale });
      }
    }
  }
  // Reading order: top-to-bottom, then left-to-right for lines on the same row.
  lines.sort((a, b) => {
    const rowTol = Math.min(a.y1 - a.y0, b.y1 - b.y0) * 0.5;
    return Math.abs(a.y0 - b.y0) <= rowTol ? a.x0 - b.x0 : a.y0 - b.y0;
  });
  return { label, width, height, lines, text: data.text ?? lines.map((l) => l.text).join("\n"), confidence: data.confidence ?? 0 };
}
