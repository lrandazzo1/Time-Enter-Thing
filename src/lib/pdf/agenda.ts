/**
 * Outlook "Detailed agenda" PDF parser (pure; works on positioned text from any PDF library).
 *
 * Outlook prints each event as:
 *
 *   Meeting title                                   ← larger font, may wrap onto several lines
 *   Tue 2026-11-03 9:30 AM - 10:00 AM               ← the anchor line we build everything around
 *   Location: Microsoft Teams Meeting
 *   Organizer: …   Required Attendees: …           ← labels, long attendee lists
 *   ____  Microsoft Teams meeting / Join / Meeting ID / Passcode / dial-in …   ← ignored boilerplate
 *
 * plus day headings ("Tuesday, November 03, 2026") and a header with the printed range.
 * All-day events print "Mon 2026-11-02 to Fri 2026-11-06" (repeated under every day) or a date only.
 * Nothing becomes an event unless it has such a date/time line; nothing is invented.
 */
import type { CalendarEvent, Period } from "../types";
import { addDays, isValidISODate } from "../time";

export interface PdfTextItem {
  str: string;
  x: number;
  y: number; // PDF user space: larger = higher on the page
  width: number;
  size: number;
  font: string;
}

export interface PdfPageText {
  page: number;
  width: number;
  height: number;
  items: PdfTextItem[];
}

export interface PdfLine {
  page: number;
  y: number;
  x: number;
  size: number;
  font: string;
  text: string;
}

export class AgendaError extends Error {
  constructor(
    public code: "no-text" | "not-detailed" | "unreadable",
    message: string,
  ) {
    super(message);
  }
}

export const NO_TEXT_MESSAGE = "This PDF doesn't contain readable meeting details. Please export from Outlook using Detailed agenda.";

/* ------------------------------ lines ------------------------------ */

/** Group text items into visual lines (same page, same baseline), ordered top-to-bottom, left-to-right. */
export function buildLines(pages: PdfPageText[]): PdfLine[] {
  const out: PdfLine[] = [];
  for (const p of pages) {
    const items = p.items.filter((i) => i.str.replace(/[\s\ue000-\uf8ff\u200b-\u200f\ufeff]/g, "") !== "").sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: PdfTextItem[][] = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r[0].y - it.y) <= Math.max(1.5, Math.min(r[0].size, it.size) * 0.3));
      if (row) row.push(it);
      else rows.push([it]);
    }
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      let text = "";
      let end = -Infinity;
      for (const it of row) {
        const gap = it.x - end;
        if (text && !/\s$/.test(text) && !/^\s/.test(it.str) && gap > it.size * 0.2) text += " ";
        text += it.str;
        end = it.x + (it.width || it.str.length * it.size * 0.5);
      }
      // Drop icon glyphs (private-use area), control and zero-width characters Outlook adds after times.
      text = text.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\ue000-\uf8ff\ufeff\ufffd]/g, " ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      // Dominant style = the item contributing the most characters.
      const main = row.reduce((best, it) => (it.str.trim().length > best.str.trim().length ? it : best), row[0]);
      out.push({ page: p.page, y: Math.min(...row.map((r) => r.y)), x: row[0].x, size: Math.round(main.size * 10) / 10, font: main.font, text });
    }
  }
  out.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  return out;
}

/* ------------------------------ date/time patterns ------------------------------ */

const DOW = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\\.?";
const DATE = "(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{2,4}|\\d{1,2}\\.\\d{1,2}\\.\\d{4})";
const TIME = "(\\d{1,2}[:.]\\d{2}(?:\\s?[AaPp]\\.?\\s?[Mm]\\.?)?)";
const TIMED = new RegExp(`^${DOW},?\\s+${DATE}\\s+${TIME}\\s*[-–—]\\s*(?:${DOW},?\\s+${DATE}\\s+)?${TIME}$`);
const ALLDAY_RANGE = new RegExp(`^${DOW},?\\s+${DATE}\\s+(?:to|-|–)\\s+${DOW},?\\s+${DATE}$`);
const ALLDAY_ONE = new RegExp(`^${DOW},?\\s+${DATE}(?:\\s*\\(?all[- ]day\\)?)?$`, "i");
const DAY_HEADING = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+\S.*\d{4}$/;
const RANGE_HEADER = new RegExp(`^${DATE}\\s+(?:to|-|–)\\s+${DATE}$`);
const LABEL = /^(Location|Organizer|Required Attendees|Optional Attendees|Resources|Categories|Show time as|Recurrence|Recurrence Pattern|Importance|When|Where|Subject|Start|End|Attendees):\s*/i;

export function parseDateText(s: string, order: "MDY" | "DMY" | "YMD" = "MDY"): string | null {
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(s))) {
    const [a, b] = [Number(r[1]), Number(r[2])];
    [m, d] = order === "DMY" || a > 12 || s.includes(".") ? [b, a] : [a, b];
    y = Number(r[3]) < 100 ? 2000 + Number(r[3]) : Number(r[3]);
  } else return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidISODate(iso) ? iso : null;
}

/** "1:30 PM" / "13:30" / "9.30 a.m." → minutes after midnight. */
export function parseClock(s: string): number | null {
  const m = /^(\d{1,2})[:.](\d{2})\s?([AaPp])?\.?\s?[Mm]?\.?$/.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toLowerCase();
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === "p" && h !== 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
  } else if (h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/* ------------------------------ redaction ------------------------------ */

/** Remove meeting links, passcodes, meeting IDs, phone numbers and full e-mail addresses. */
export function redact(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\b(passcode|password|pin|meeting id|conference id|phone conference id|access code)\s*:?\s*[^\n;]*/gi, "$1: [hidden]")
    .replace(/\+\d[\d\s().-]{6,}\d(,,\d+#?)?|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b(,,\d+#?)?/g, "[phone]")
    .replace(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "…@$1");
}

/* ------------------------------ parse ------------------------------ */

export interface AgendaResult {
  events: CalendarEvent[];
  /** Printed range from the PDF header ("2026-11-01 to 2026-11-07"), else the span of event dates. */
  period: Period | null;
  pages: number;
  dayHeadings: number;
  duplicatesRemoved: { title: string; date: string; start: string | null }[];
  warnings: string[];
}

interface Found {
  timeIdx: number;
  titleStart: number;
  title: string;
  kind: "timed" | "allday";
  m: RegExpExecArray;
}

export function parseAgenda(pages: PdfPageText[], opts: { dateOrder?: "MDY" | "DMY" | "YMD" } = {}): AgendaResult {
  const order = opts.dateOrder ?? "MDY";
  const lines = buildLines(pages);
  if (lines.length === 0 || lines.every((l) => l.text.length < 2)) throw new AgendaError("no-text", NO_TEXT_MESSAGE);

  const found: Found[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text;
    let kind: Found["kind"] | null = null;
    let m = TIMED.exec(text);
    if (m) kind = "timed";
    else if ((m = ALLDAY_RANGE.exec(text)) || (m = ALLDAY_ONE.exec(text))) kind = "allday";
    if (!kind || !m) continue;
    // Title = the line(s) directly above, in a larger font than the date line.
    const above = lines[i - 1];
    if (!above || above.size <= lines[i].size + 0.4 || DAY_HEADING.test(above.text) || LABEL.test(above.text)) {
      if (kind === "timed") warnings.push(`Found a meeting time (“${text}”) without a readable title — it was skipped.`);
      continue;
    }
    let start = i - 1;
    while (start - 1 >= 0 && found.every((f) => f.timeIdx !== start - 1)) {
      const prev = lines[start - 1];
      const cur = lines[start];
      if (prev.size !== above.size || prev.font !== above.font || DAY_HEADING.test(prev.text)) break;
      const adjacent = prev.page === cur.page ? prev.y - cur.y <= cur.size * 1.8 : lines.findIndex((l) => l.page === cur.page) === start;
      if (!adjacent || i - start >= 5) break;
      start--;
    }
    const title = lines.slice(start, i).map((l) => l.text).join(" ").replace(/\s+/g, " ").trim();
    found.push({ timeIdx: i, titleStart: start, title, kind, m });
  }

  const dayHeadings = lines.filter((l) => DAY_HEADING.test(l.text)).length;
  if (found.length === 0) {
    const hasClockTimes = lines.some((l) => /\b\d{1,2}(:\d{2})?\s?(AM|PM)\b/i.test(l.text));
    throw new AgendaError(
      "not-detailed",
      hasClockTimes || dayHeadings
        ? "This looks like a calendar PDF, but not Outlook's Detailed agenda: no meeting has a full date and start–end time. Print again with the “Detailed agenda” style and save as PDF."
        : NO_TEXT_MESSAGE,
    );
  }

  const events: CalendarEvent[] = [];
  const seen = new Map<string, CalendarEvent>();
  const duplicatesRemoved: AgendaResult["duplicatesRemoved"] = [];
  found.forEach((f, k) => {
    const bodyEnd = k + 1 < found.length ? found[k + 1].titleStart : lines.length;
    const body = lines.slice(f.timeIdx + 1, bodyEnd).filter((l) => !DAY_HEADING.test(l.text));
    const { organizer, location, domains } = details(body);
    const canceled = /^\s*cancel+ed\s*:/i.test(f.title);
    const src = redact([f.title, lines[f.timeIdx].text, location && `Location: ${location}`, organizer && `Organizer: ${organizer}`].filter(Boolean).join("\n"));
    const base = { title: f.title, description: "", location: location ?? "", canceled, recurring: false, source: "pdf" as const, sourceLabel: `PDF page ${lines[f.timeIdx].page}`, organizer, domains, sourceText: src };

    if (f.kind === "allday") {
      const d1 = parseDateText(f.m[1], order);
      const d2 = f.m[2] ? parseDateText(f.m[2], order) : d1;
      if (!d1 || !d2) return warnings.push(`Couldn't read the date in “${lines[f.timeIdx].text}”.`);
      const key = `allday|${f.title.toLowerCase()}|${d1}|${d2}`;
      if (seen.has(key)) return; // Outlook repeats multi-day events under every day
      const ev: CalendarEvent = { ...base, date: d1, endDate: d2 !== d1 ? d2 : undefined, start: null, end: null, minutes: null, allDay: true, status: canceled ? "free" : "busy" };
      seen.set(key, ev);
      events.push(ev);
      return;
    }

    const [, dS, tS, dE, tE] = f.m;
    const startDate = parseDateText(dS, order);
    const endDate = dE ? parseDateText(dE, order) : startDate;
    const s = parseClock(tS);
    const e = parseClock(tE);
    if (!startDate || !endDate || s === null || e === null) return warnings.push(`Couldn't read the time in “${lines[f.timeIdx].text}”.`);
    // End on a later day: explicit second date, or an end time before the start (e.g. 11:00 PM - 1:00 AM).
    const nextDay = endDate > startDate || (!dE && e <= s && !(e === 0 && s > 0));
    const realEndDate = dE ? endDate : nextDay ? addDays(startDate, 1) : startDate;
    const key = `${f.title.toLowerCase()}|${startDate}|${s}|${realEndDate}|${e}`;
    if (seen.has(key)) {
      duplicatesRemoved.push({ title: f.title, date: startDate, start: hhmm(s) });
      return;
    }
    if (realEndDate === startDate && e < s) return warnings.push(`“${f.title}” ends before it starts (${lines[f.timeIdx].text}) — skipped.`);
    const common = { ...base, status: canceled ? ("free" as const) : ("busy" as const), allDay: false };
    if (realEndDate > startDate) {
      // Split at midnight so each work date gets only its own time.
      const first: CalendarEvent = { ...common, date: startDate, start: hhmm(s), end: "24:00", minutes: 24 * 60 - s, crossesMidnight: true };
      events.push(first);
      seen.set(key, first);
      let d = addDays(startDate, 1);
      while (d < realEndDate) {
        events.push({ ...common, date: d, start: "00:00", end: "24:00", minutes: 24 * 60, crossesMidnight: true });
        d = addDays(d, 1);
      }
      if (e > 0) events.push({ ...common, date: realEndDate, start: "00:00", end: hhmm(e), minutes: e, crossesMidnight: true });
      return;
    }
    const ev: CalendarEvent = { ...common, date: startDate, start: hhmm(s), end: e === 24 * 60 ? "24:00" : hhmm(e), minutes: (e === 0 ? 24 * 60 : e) - s };
    seen.set(key, ev);
    events.push(ev);
  });

  // Printed range header (first page), else the span of event dates.
  let period: Period | null = null;
  for (const l of lines.slice(0, 12)) {
    const r = RANGE_HEADER.exec(l.text);
    if (r) {
      const a = parseDateText(r[1], order);
      const b = parseDateText(r[2], order);
      if (a && b) period = { start: a, end: b };
      break;
    }
  }
  if (!period && events.length) {
    const ds = events.map((e) => e.date).sort();
    period = { start: ds[0], end: ds[ds.length - 1] };
  }
  events.sort((a, b) => (a.date + (a.start ?? "")).localeCompare(b.date + (b.start ?? "")));
  dropOwnDomain(events);
  return { events, period, pages: pages.length, dayHeadings, duplicatesRemoved, warnings };
}

function details(body: PdfLine[]): { organizer?: string; location?: string; domains: string[] } {
  let organizer: string | undefined;
  let location: string | undefined;
  const domains = new Set<string>();
  let inAttendees = false;
  for (const l of body) {
    const t = l.text;
    const lab = LABEL.exec(t);
    if (lab) {
      const value = t.slice(lab[0].length).trim();
      const name = lab[1].toLowerCase();
      inAttendees = name.includes("attendees") || name === "resources";
      if (name === "organizer" && !organizer) organizer = value.replace(/<[^>]*>/g, "").trim() || undefined;
      if (name === "location" && !location) location = value.slice(0, 120) || undefined;
      if (inAttendees || name === "organizer") collect(value, domains);
      continue;
    }
    if (/^_{5,}/.test(t)) {
      inAttendees = false;
      continue;
    }
    if (inAttendees) collect(t, domains);
  }
  return { organizer, location, domains: [...domains] };
}

const GENERIC = new Set(["gmail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "msn.com"]);
function collect(text: string, into: Set<string>) {
  for (const m of text.matchAll(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
    const d = m[1].toLowerCase();
    if (!GENERIC.has(d)) into.add(d);
  }
}

/** The user's own company domain appears on almost every meeting; drop it so it isn't used as a client hint. */
function dropOwnDomain(events: CalendarEvent[]) {
  const withDomains = events.filter((e) => e.domains?.length);
  if (withDomains.length < 3) return;
  const counts = new Map<string, number>();
  for (const e of withDomains) for (const d of e.domains!) counts.set(d, (counts.get(d) ?? 0) + 1);
  const own = [...counts].filter(([, n]) => n / withDomains.length >= 0.6).map(([d]) => d);
  for (const e of events) if (e.domains) e.domains = e.domains.filter((d) => !own.includes(d));
}
