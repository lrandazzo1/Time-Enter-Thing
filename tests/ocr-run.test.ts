/**
 * Page-by-page text recognition runner: no page cap, one page at a time, failures and timeouts don't stop
 * the run, cancel keeps what was read, retry continues with the missing pages, and meetings that span a
 * page break are read once. Pages are synthetic OCR output (fictional data).
 */
import { describe, expect, it } from "vitest";
import { parseAgenda, type PdfPageText } from "@/lib/pdf/agenda";
import { meetingsSoFar, missingPages, newOcrState, pageRanges, readPages, runSequential } from "@/lib/pdf/ocrRun";

const H = 2000;
type L = { text: string; size: number };
const T = (text: string): L => ({ text, size: 30 }); // title
const D = (text: string): L => ({ text, size: 24 }); // date/time line and body
const page = (n: number, lines: L[]): PdfPageText => {
  let y = 100;
  return {
    page: n,
    width: 1500,
    height: H,
    items: lines.map((l) => {
      const item = { str: l.text, x: 100, y: H - (y + l.size), width: l.text.length * l.size * 0.5, size: l.size * 0.8, font: "ocr", conf: 90 };
      y += l.size * 1.5;
      return item;
    }),
  };
};
const day = (n: number) => 2 + Math.floor((n - 1) / 6); // 6 pages per day, Nov 2–6
const date = (n: number) => `${["Mon", "Tue", "Wed", "Thu", "Fri"][day(n) - 2]} 11/${day(n)}/2026`;

/** A 28-page agenda: one meeting per page, and the meeting on page 20/21 has its title on page 20 and time on 21. */
function agenda(): PdfPageText[] {
  return Array.from({ length: 28 }, (_, i) => {
    const n = i + 1;
    const lines: L[] = [];
    if (n === 1) lines.push(D("11/2/2026 to 11/6/2026"));
    if (n === 21) lines.push(D(`${date(21)} 3:00 PM - 4:00 PM`), D("Location: Microsoft Teams Meeting"));
    lines.push(T(`Client ${n} | Planning | Session ${n}`), D(`${date(n)} ${8 + (n % 4)}:00 AM - ${8 + (n % 4)}:30 AM`), D("Organizer: Sam Organizer"), D("Required Attendees: Person A; Person B;"));
    if (n === 20) lines.push(T("Client 20 | Planning | Spans the page break"));
    return page(n, lines);
  });
}

const titles = (pages: PdfPageText[]) => parseAgenda(pages, { ocr: true }).events.map((e) => `${e.date} ${e.start} ${e.title}`);

describe("sequential page runner", () => {
  it("processes every page of a long PDF one at a time — no page cap", async () => {
    const all = Array.from({ length: 60 }, (_, i) => page(i + 1, [D("x")]));
    const state = newOcrState("f", 60);
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];
    const res = await runSequential(state, {
      pages: missingPages(state),
      process: async (n) => {
        active++;
        maxActive = Math.max(maxActive, active);
        order.push(n);
        await new Promise((r) => setTimeout(r, 1));
        active--;
        return all[n - 1];
      },
    });
    expect(res.cancelled).toBe(false);
    expect(maxActive).toBe(1);
    expect(order).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(missingPages(state)).toEqual([]);
  });

  it("a page that fails or times out is recorded and the run continues", async () => {
    const pages = agenda();
    const state = newOcrState("f", 28);
    const done: [number, boolean][] = [];
    await runSequential(state, {
      pages: missingPages(state),
      timeoutMs: 50,
      process: async (n) => {
        if (n === 5) throw new Error("render failed");
        if (n === 9) await new Promise((r) => setTimeout(r, 500));
        return pages[n - 1];
      },
      onPage: (n, ok) => done.push([n, ok]),
    });
    expect(state.failed).toEqual({ 5: "couldn't be read", 9: "took too long" });
    expect(missingPages(state)).toEqual([5, 9]);
    expect(done).toHaveLength(28);
    expect(readPages(state)).toHaveLength(26);
  });

  it("cancel keeps the pages read so far; retrying the rest gives the same result as one full run, without duplicates", async () => {
    const pages = agenda();
    const full = titles(pages);
    expect(full).toHaveLength(29); // one meeting per page + the one spanning pages 20–21
    // The meeting whose title is at the bottom of page 20 and whose time is at the top of page 21 is read once.
    expect(full.filter((t) => t.includes("Spans the page break"))).toEqual(["2026-11-05 15:00 Client 20 | Planning | Spans the page break"]);

    const state = newOcrState("f", 28);
    const ctrl = new AbortController();
    const res = await runSequential(state, {
      pages: missingPages(state),
      signal: ctrl.signal,
      process: async (n) => {
        await new Promise((r) => setTimeout(r, 1));
        if (n === 21) setTimeout(() => ctrl.abort(), 1); // user presses Cancel while page 21 is being read
        await new Promise((r) => setTimeout(r, n === 21 ? 50 : 1));
        return pages[n - 1];
      },
    });
    expect(res.cancelled).toBe(true);
    expect(missingPages(state)).toEqual(Array.from({ length: 8 }, (_, i) => 21 + i));
    expect(pageRanges(missingPages(state))).toBe("21–28");
    const partial = titles(readPages(state));
    expect(partial).toHaveLength(20); // pages 1–20; the page-20/21 meeting's time is on page 21, not read yet
    expect(meetingsSoFar(state)).toBe(20);

    const retry = await runSequential(state, { pages: missingPages(state), process: async (n) => pages[n - 1] });
    expect(retry.cancelled).toBe(false);
    expect(missingPages(state)).toEqual([]);
    expect(titles(readPages(state))).toEqual(full);
  });

  it("a missing page in the middle never joins a title to a time two pages away", () => {
    // Page 21 wasn't read; page 22 starts with the time of a meeting whose title was on page 21.
    const pages = agenda().filter((p) => p.page !== 21);
    const p22 = pages.find((p) => p.page === 22)!;
    pages[pages.indexOf(p22)] = page(22, [D("Thu 11/5/2026 2:00 PM - 2:30 PM"), D("Location: Microsoft Teams Meeting"), T("Client 22 | Planning | Session 22"), D("Thu 11/5/2026 9:00 AM - 9:30 AM")]);
    const evs = parseAgenda(pages, { ocr: true }).events;
    expect(evs.some((e) => e.title.includes("Spans the page break"))).toBe(false);
    const orphan = evs.find((e) => e.start === "14:00")!;
    expect(orphan.title).toBe("Meeting at 14:00 (title not found)");
    expect(orphan.parseNotes?.some((n) => /No meeting title/.test(n.message))).toBe(true);
    expect(evs.find((e) => e.title === "Client 22 | Planning | Session 22")?.start).toBe("09:00");
  });

  it("page ranges", () => {
    expect(pageRanges([21, 22, 23, 28, 3, 5, 6])).toBe("3, 5–6, 21–23, 28");
    expect(pageRanges([7])).toBe("7");
  });
});
