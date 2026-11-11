/**
 * Page-by-page text recognition bookkeeping, independent of the browser (unit-tested in Node).
 *
 * Pages are processed one at a time, so memory stays at one rendered page no matter how long the PDF is;
 * there is no page limit. Each page's result is stored in `state.pages[page - 1]`. A page that fails or
 * times out is recorded in `state.failed` and the run continues with the next page. Cancelling stops
 * after releasing the current page. Pages still missing afterwards can be retried later; the meetings are
 * always parsed from all pages read so far, in page order, so events spanning a page break keep their
 * context and nothing is counted twice.
 */
import { parseAgenda, type PdfPageText } from "./agenda";

export interface OcrPagesState {
  /** Identifies the PDF (name + size + modified time) so a retry continues the same file. */
  fileKey: string;
  total: number;
  pages: (PdfPageText | null)[];
  /** page number → reason, for pages that were attempted and failed. */
  failed: Record<number, string>;
}

export const newOcrState = (fileKey: string, total: number): OcrPagesState => ({ fileKey, total, pages: Array.from({ length: total }, () => null), failed: {} });

/** 1-based numbers of the pages not read yet (failed, cancelled or never reached). */
export const missingPages = (s: OcrPagesState): number[] => s.pages.flatMap((p, i) => (p ? [] : [i + 1]));

export const readPages = (s: OcrPagesState): PdfPageText[] => s.pages.filter((p): p is PdfPageText => Boolean(p));

/** "21–28", "3, 5, 9–11" */
export function pageRanges(nums: number[]): string {
  const out: string[] = [];
  const sorted = [...nums].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i]}–${sorted[j]}` : `${sorted[i]}`);
    i = j;
  }
  return out.join(", ");
}

/** Timed meetings recognisable in the pages read so far (for the live counter). */
export function meetingsSoFar(s: OcrPagesState, dateOrder?: "MDY" | "DMY" | "YMD"): number {
  const pages = readPages(s);
  if (!pages.length) return 0;
  try {
    return parseAgenda(pages, { ocr: true, dateOrder }).events.filter((e) => !e.allDay).length;
  } catch {
    return 0;
  }
}

export interface RunOptions {
  /** Pages to process, in order (1-based). */
  pages: number[];
  signal?: AbortSignal;
  /** Per-page time limit; a page taking longer is recorded as failed and the run continues. */
  timeoutMs?: number;
  /** Render + recognise one page. Must release its own resources; `signal` aborts on cancel/timeout. */
  process: (page: number, signal: AbortSignal) => Promise<PdfPageText>;
  onStart?: (page: number, index: number, count: number) => void;
  onPage?: (page: number, ok: boolean, reason?: string) => void;
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "AbortError";
  }
}

/** Process pages strictly one after another. Resolves with `cancelled: true` if the user cancelled. */
export async function runSequential(state: OcrPagesState, opts: RunOptions): Promise<{ cancelled: boolean }> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  for (let k = 0; k < opts.pages.length; k++) {
    const page = opts.pages[k];
    if (opts.signal?.aborted) return { cancelled: true };
    opts.onStart?.(page, k, opts.pages.length);
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const data = await Promise.race([
        opts.process(page, ctrl.signal),
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => {
            ctrl.abort();
            rej(new Error("timeout"));
          }, timeoutMs);
        }),
        new Promise<never>((_, rej) => {
          onAbort = () => {
            ctrl.abort();
            rej(new CancelledError());
          };
          opts.signal?.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
      state.pages[page - 1] = { ...data, page };
      delete state.failed[page];
      opts.onPage?.(page, true);
    } catch (e) {
      if (opts.signal?.aborted || e instanceof CancelledError) return { cancelled: true };
      const reason = (e as Error)?.message === "timeout" ? "took too long" : "couldn't be read";
      state.failed[page] = reason;
      opts.onPage?.(page, false, reason);
    } finally {
      clearTimeout(timer);
      if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
    }
  }
  return { cancelled: false };
}
