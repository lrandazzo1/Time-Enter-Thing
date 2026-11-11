"use client";
import { fromTesseract, type OcrPage } from "./types";
import { preprocessImage } from "./preprocess";

/**
 * Local, in-browser OCR with Tesseract.js.
 * The worker script, WebAssembly core and English model are served from this site's own
 * /tesseract/ folder (see scripts/copy-ocr-assets.mjs). Images never leave the device:
 * they are decoded in the page and handed to a Web Worker running on this computer.
 */

export interface OcrProgress {
  index: number;
  total: number;
  label: string;
  status: string;
  /** 0–1 for the current image */
  progress: number;
}

export type OcrMode = "list" | "calendar" | "document";

function assetBase(): string {
  return `${window.location.origin}/tesseract`;
}

export async function ocrImages(files: File[], opts: { mode: OcrMode; onProgress?: (p: OcrProgress) => void; signal?: AbortSignal }): Promise<OcrPage[]> {
  if (files.length === 0) return [];
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  let current = { index: 0, label: files[0].name };
  const report = (status: string, progress: number) => opts.onProgress?.({ index: current.index, total: files.length, label: current.label, status, progress });
  report("Loading the text-recognition engine (first time only, ~11 MB)…", 0);
  const base = assetBase();
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: `${base}/worker.min.js`,
    corePath: `${base}/core`,
    langPath: `${base}/lang`,
    gzip: true,
    workerBlobURL: false,
    cacheMethod: "write", // caches the language model in this browser's IndexedDB
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") report("Reading text…", m.progress);
      else report(m.status.replace(/^./, (c) => c.toUpperCase()), m.progress);
    },
    errorHandler: () => {},
  });
  const pages: OcrPage[] = [];
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: opts.mode === "calendar" ? PSM.SPARSE_TEXT : PSM.AUTO,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });
    for (let i = 0; i < files.length; i++) {
      if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      current = { index: i, label: files[i].name || `Screenshot ${i + 1}` };
      report("Preparing image…", 0);
      const prepared = await preprocessImage(files[i]);
      const { data } = await worker.recognize(prepared.canvas, {}, { blocks: true, text: true });
      pages.push(fromTesseract(current.label, data, prepared.width, prepared.height, prepared.scale));
      prepared.canvas.width = prepared.canvas.height = 0; // release memory
      report("Done", 1);
    }
  } finally {
    await worker.terminate();
  }
  return pages;
}
