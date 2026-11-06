import type { CalendarEvent, Period, Settings } from "../types";
import type { OcrLine, OcrPage } from "../ocr/types";
import { intervalMinutes } from "../time";
import { findDate, parseTimeRange } from "./paste";

/**
 * Turn OCR text from Outlook calendar screenshots into *provisional* events.
 *
 * Only text that is actually visible is used:
 * - Times come only from explicit text such as "9:00 AM - 10:00 AM". Block height/position is never
 *   converted into a duration; events without a visible time get no hours and are flagged.
 * - Dates come from visible text, or from the column header above the event (flagged as inferred).
 * Everything produced here is marked for verification in review.
 */

const GRID_LABEL = /^(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?|noon|midnight|all day|today|week|month|day|work week)$/i;
const CHROME = /^(?:new event|new|today|month|week|work week|day|share|print|meet now|calendar|my calendars|show as|busy|free|tentative|microsoft teams meeting|teams meeting|join|accepted|organizer|location|private|show all|filter|view|file|home|send\/receive|folder|help)$/i;
const HEADER = /^(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s*\d{1,2}(?:\/\d{1,2})?|\d{1,2}\s+(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?|(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+[a-z]{3,9}\.?\s+\d{1,2}(?:,?\s+\d{4})?)$/i;

interface Column {
  date: string;
  cx: number;
  y1: number;
}

export function calendarEventsFromOcr(pages: OcrPage[], period: Period, settings: Pick<Settings, "csvDateOrder">): { events: CalendarEvent[]; warnings: string[] } {
  const events: CalendarEvent[] = [];
  const warnings: string[] = [];
  for (const page of pages) {
    const columns: Column[] = [];
    const candidates: OcrLine[] = [];
    for (const l of page.lines) {
      const text = l.text.trim();
      if (!text) continue;
      if (HEADER.test(text) || (text.length <= 24 && /^(mon|tue|wed|thu|fri|sat|sun)/i.test(text) && findDate(text, period, settings.csvDateOrder))) {
        const date = findDate(text, period, settings.csvDateOrder)?.date ?? headerDayOnly(text, period);
        if (date) columns.push({ date, cx: (l.x0 + l.x1) / 2, y1: l.y1 });
        continue;
      }
      if (GRID_LABEL.test(text) || CHROME.test(text) || (!/[a-z]{3,}/i.test(text) && !parseTimeRange(text))) continue;
      candidates.push(l);
    }
    // Group lines into visual blocks: same column, small vertical gap.
    const blocks: OcrLine[][] = [];
    for (const l of candidates.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
      const h = l.y1 - l.y0;
      const blk = [...blocks].reverse().find((b) => {
        const last = b[b.length - 1];
        const overlapX = Math.min(last.x1, l.x1) - Math.max(last.x0, l.x0);
        return overlapX > 0.5 * Math.min(last.x1 - last.x0, l.x1 - l.x0) && l.y0 - last.y1 >= -2 && l.y0 - last.y1 < h * 0.9;
      });
      if (blk) blk.push(l);
      else blocks.push([l]);
    }
    blocks.sort((a, b) => a[0].y0 - b[0].y0 || a[0].x0 - b[0].x0);
    for (const b of blocks) {
      const texts = b.map((l) => l.text.trim());
      let start: string | null = null;
      let end: string | null = null;
      const titleLines: string[] = [];
      const extraLines: string[] = [];
      let date: string | null = null;
      const notes: CalendarEvent["parseNotes"] = [];
      let titleDone = false;
      for (const t of texts) {
        const tr = parseTimeRange(t);
        if (tr && !start) {
          start = tr.start;
          end = tr.end;
          const rest = (t.slice(0, tr.index) + " " + t.slice(tr.index + tr.length)).trim();
          if (rest && /[a-z]{3,}/i.test(rest)) (titleDone ? extraLines : titleLines).push(rest);
          titleDone = true;
          continue;
        }
        if (CHROME.test(t)) {
          titleDone = true;
          continue;
        }
        const d = findDate(t, period, settings.csvDateOrder);
        if (d && !date) date = d.date;
        (titleDone ? extraLines : titleLines).push(t);
      }
      if (!titleLines.length) continue;
      // A block's title may wrap onto several lines; join them.
      const title = titleLines.join(" ").replace(/\s+([|,;:])/g, " $1").replace(/\s{2,}/g, " ").replace(/[;,]\s*$/, "").trim();
      const extra = extraLines.join(" · ");
      if (!date && columns.length) {
        const cx = (b[0].x0 + b[0].x1) / 2;
        const below = columns.filter((c) => c.y1 <= b[0].y0 + 2);
        const pool = below.length ? below : columns;
        const nearest = pool.reduce((best, c) => (Math.abs(c.cx - cx) < Math.abs(best.cx - cx) ? c : best));
        date = nearest.date;
        notes.push({ code: "screenshot-date", message: "Date inferred from the calendar column in the screenshot — verify." });
      }
      if (start && end) notes.push({ code: "screenshot-time", message: "Times read from the screenshot text — verify against Outlook." });
      else notes.push({ code: "screenshot-time", message: "No start/end time is visible in the screenshot — enter the hours you worked." });
      if (/…|\.\.\.$/.test(title)) notes.push({ code: "info", message: "The title looks truncated in the screenshot." });
      if (b.some((l) => l.confidence < 60)) notes.push({ code: "screenshot-time", message: "Some text was hard to read — check the title." });
      events.push({
        title,
        description: extra,
        location: "",
        date: date ?? "",
        start,
        end,
        minutes: start && end ? intervalMinutes(start, end) : null,
        allDay: false,
        canceled: /^\s*cancel+ed\s*:/i.test(title),
        status: "unknown",
        recurring: false,
        source: "screenshot",
        sourceLabel: page.label,
        parseNotes: notes,
      });
    }
    if (!columns.length) warnings.push(`${page.label}: no day headers were readable; set each event's date in review.`);
  }
  return { events, warnings };
}

/** "Mon 2" style headers: pick the date in the period with that day-of-month. */
function headerDayOnly(text: string, period: Period): string | null {
  const m = /(\d{1,2})/.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const [y, mo] = period.start.split("-").map(Number);
  for (let k = 0; k < 2; k++) {
    const dt = new Date(Date.UTC(y, mo - 1 + k, day));
    const iso = dt.toISOString().slice(0, 10);
    if (iso >= period.start && iso <= period.end) return iso;
  }
  return null;
}
