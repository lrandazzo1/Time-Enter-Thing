/**
 * Outlook "Detailed agenda" PDF parser (pure; works on positioned text from any PDF library or OCR).
 *
 * New Outlook / Outlook on the web prints each event as:
 *
 *   Meeting title                                   ← larger or bold font, may wrap onto several lines
 *   Mon 11/2/2026 9:30 AM - 10:00 AM                ← date + time range (the anchor line)
 *   Location: Microsoft Teams Meeting
 *   Organizer: …   Required Attendees: …           ← labels, long attendee lists
 *   ____  Microsoft Teams meeting / Join / Meeting ID / Passcode / dial-in …   ← ignored
 *
 * with day headings ("Monday, November 2, 2026") and a header with the printed range. Other Outlook
 * versions, locales and PDF printers vary this: month-name dates, 24-hour times, the date and the time on
 * separate lines, the time in a left column beside the title (date from the day heading), browser
 * headers/footers, icons after the time. Lines are classified by recognising dates and times as tokens
 * (several patterns each), not with one rigid expression.
 *
 * Nothing becomes an event unless a date and a start–end time were read; hours are never invented.
 * Events that were read but are uncertain carry a "pdf-check" note; lines that look like a meeting time
 * but couldn't be interpreted are returned in `rejected` so the user can add them by hand.
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
  /** OCR confidence 0–100 (text recognition only). */
  conf?: number;
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
  conf?: number;
}

/** Facts about the extracted text that are safe to show/copy: counts and the PDF producer, never content. */
export interface TextStats {
  pages: number;
  pagesWithText: number;
  textItems: number;
  nonEmptyItems: number;
  characters: number;
  /** Share of non-space characters that are letters or digits (0–1). */
  readableRatio: number;
  fonts: number;
  producer?: string;
  creator?: string;
  pageErrors?: number;
}

export type TextStatus = "ok" | "no-text" | "undecodable";

export interface AgendaDiagnostics {
  method: "text" | "ocr";
  stats?: TextStats;
  status?: TextStatus;
  lines: number;
  dayHeadings: number;
  /** Lines containing a recognisable date or time. */
  dateTimeLines: number;
  layout: string;
  candidates: number;
  parsed: number;
  flagged: number;
  rejected: number;
  rejections: Record<string, number>;
  titleRules: Record<string, number>;
  /** Masked line shapes (letters → a/A, digits → 9; weekday/month/AM/PM kept) — no meeting content. */
  shapes: string[];
  ocr?: { pages: number; meanConfidence: number; lowConfidenceLines: number };
}

export type AgendaErrorCode = "no-text" | "undecodable" | "unrecognized" | "unreadable";

export class AgendaError extends Error {
  constructor(
    public code: AgendaErrorCode,
    message: string,
    public diagnostics?: AgendaDiagnostics,
    /** Technical category for extraction failures (e.g. PDF_WORKER), safe to show. */
    public category?: string,
  ) {
    super(message);
  }
}

export const NO_TEXT_MESSAGE = "This PDF doesn't contain selectable text. Try saving it directly from Outlook using Print detailed agenda.";
export const UNDECODABLE_MESSAGE =
  "This PDF contains text, but its characters can't be decoded (some PDF printers store text this way). Try saving it again from Outlook with Print detailed agenda and the “Save as PDF” printer.";
export const UNRECOGNIZED_MESSAGE = "We were able to read this PDF, but couldn't identify the meeting dates and times. Your Outlook export may use a different format.";
export const PARTIAL_MESSAGE = "Some meetings couldn't be interpreted. Review the flagged items before exporting.";

/* ------------------------------ normalization & lines ------------------------------ */

const JUNK = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\ue000-\uf8ff\ufeff\ufffd]|[\u{f0000}-\u{10ffff}]/gu;

/** Unicode-normalise a line: ligatures, full-width forms and odd spaces (NFKC), dashes, a.m./p.m., icons. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(JUNK, " ")
    .replace(/[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/g, "-")
    .replace(/\b([ap])\.\s?m\.?(?=\s|$|[),;])/gi, (_, c: string) => `${c.toUpperCase()}M`)
    // Text recognition sometimes glues punctuation between the year and the time ("2026°10:00", "AM.-").
    .replace(/(\d{4})[/°.,·]+(?=\d{1,2}[:.]\d{2})/g, "$1 ")
    .replace(/\b([AP]M)\.(?=\s*-)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// Helvetica/Arial advance widths (1/1000 em) for ASCII 32–126 — close enough for other sans-serif fonts.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

/** Approximate advance of a string in ems, used when a PDF omits glyph widths. */
export function estimateWidth(str: string): number {
  let w = 0;
  for (const c of str) {
    const code = c.charCodeAt(0);
    w += (code >= 32 && code <= 126 ? HELV[code - 32] : 556) / 1000;
  }
  return w;
}

/** Group text items into visual lines (same page, same baseline), ordered top-to-bottom, left-to-right. */
export function buildLines(pages: PdfPageText[]): PdfLine[] {
  const out: PdfLine[] = [];
  for (const p of pages) {
    const items = p.items.filter((i) => i.str.replace(JUNK, "").trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: PdfTextItem[][] = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r[0].y - it.y) <= Math.max(1.5, Math.min(r[0].size, it.size) * 0.3));
      if (row) row.push(it);
      else rows.push([it]);
    }
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      // Calibrate the width estimate to this row's font: median of (actual pitch / estimated advance).
      let cal = 1;
      if (row.some((r) => !(r.width > 0))) {
        const ratios = row
          .slice(0, -1)
          .map((r, k) => (row[k + 1].x - r.x) / (estimateWidth(r.str) * r.size))
          .filter((v) => Number.isFinite(v) && v > 0)
          .sort((a, b) => a - b);
        if (ratios.length >= 3) cal = Math.min(1.5, Math.max(0.7, ratios[Math.floor(ratios.length / 2)]));
      }
      let text = "";
      let end = -Infinity;
      let estimated = false;
      for (const it of row) {
        // Items without a width (some PDF printers write each glyph separately and omit metrics):
        // estimate where the previous glyph ended from typical character widths (a space is ~0.28 em).
        const gap = it.x - end;
        if (text && !/\s$/.test(text) && !/^\s/.test(it.str) && gap > it.size * (estimated ? 0.17 : 0.2)) text += " ";
        text += it.str;
        estimated = !(it.width > 0);
        end = it.x + (estimated ? estimateWidth(it.str) * it.size * cal : it.width);
      }
      text = normalizeText(text);
      if (!text) continue;
      // Dominant style = the item contributing the most characters.
      const main = row.reduce((best, it) => (it.str.trim().length > best.str.trim().length ? it : best), row[0]);
      const confs = row.map((r) => r.conf).filter((c): c is number => typeof c === "number");
      out.push({ page: p.page, y: Math.min(...row.map((r) => r.y)), x: row[0].x, size: Math.round(main.size * 10) / 10, font: main.font, text, conf: confs.length ? Math.min(...confs) : undefined });
    }
  }
  out.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  return out;
}

/** Count what was extracted, and decide whether it is usable text at all. */
export function textStats(pages: PdfPageText[], extra: Partial<TextStats> = {}): TextStats {
  let textItems = 0;
  let nonEmpty = 0;
  let chars = 0;
  let readable = 0;
  const fonts = new Set<string>();
  let pagesWithText = 0;
  for (const p of pages) {
    let any = false;
    for (const it of p.items) {
      textItems++;
      const s = it.str.replace(/\s/g, "");
      if (!s) continue;
      nonEmpty++;
      any = true;
      fonts.add(it.font);
      for (const ch of s) {
        chars++;
        if (/[\p{L}\p{N}]/u.test(ch) && !/[\ue000-\uf8ff]/.test(ch)) readable++;
      }
    }
    if (any) pagesWithText++;
  }
  return { pages: pages.length, pagesWithText, textItems, nonEmptyItems: nonEmpty, characters: chars, readableRatio: chars ? Math.round((readable / chars) * 100) / 100 : 0, fonts: fonts.size, ...extra };
}

export function textStatus(s: TextStats): TextStatus {
  if (s.nonEmptyItems === 0 || s.characters < 3) return "no-text";
  if (s.readableRatio < 0.4) return "undecodable";
  return "ok";
}

/* ------------------------------ date/time tokens ------------------------------ */

const WD_FULL = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const WD_ABBR = "mon|tues|tue|wed|thurs|thur|thu|fri|sat|sun";
const MONTH = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";
const WD = `(?:(${WD_FULL}|${WD_ABBR})\\.?,?\\s+)?`;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthNo = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

type DateOrder = "MDY" | "DMY" | "YMD";

interface DateHit {
  index: number;
  length: number;
  iso: string;
  weekday?: string;
  /** Full weekday name or a month written as a word (typical of day headings). */
  long: boolean;
  /** The weekday printed doesn't match the date. */
  mismatch?: boolean;
}

interface TimeHit {
  index: number;
  length: number;
  min: number; // minutes after midnight, in the 12-hour sense when !meridiem
  meridiem: "a" | "p" | null;
  hour: number;
}

const DATE_PATTERNS: { re: RegExp; kind: "iso" | "num" | "mname" | "dname" | "dash" }[] = [
  { re: new RegExp(`\\b${WD}(\\d{4})-(\\d{1,2})-(\\d{1,2})\\b`, "gi"), kind: "iso" },
  { re: new RegExp(`\\b${WD}(\\d{1,2})([/.-])(\\d{1,2})\\3(\\d{4}|\\d{2})\\b`, "gi"), kind: "num" },
  { re: new RegExp(`\\b${WD}(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"), kind: "mname" },
  { re: new RegExp(`\\b${WD}(\\d{1,2})(?:st|nd|rd|th)?\\.?\\s+(${MONTH})\\.?,?\\s+(\\d{4})\\b`, "gi"), kind: "dname" },
  { re: new RegExp(`\\b${WD}(\\d{1,2})-(${MONTH})-(\\d{2,4})\\b`, "gi"), kind: "dash" },
];

const iso = (y: number, m: number, d: number) => {
  const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidISODate(s) ? s : null;
};
const weekdayOf = (isoDate: string) => WEEKDAYS[new Date(`${isoDate}T12:00:00Z`).getUTCDay()];
const yr = (s: string) => (s.length <= 2 ? 2000 + Number(s) : Number(s));

/** Every date in a line (several notations; the printed weekday settles day/month order when it can). */
export function findDates(text: string, order: DateOrder = "MDY"): DateHit[] {
  const hits: DateHit[] = [];
  for (const { re, kind } of DATE_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const wd = m[1]?.toLowerCase();
      let value: string | null = null;
      let mismatch = false;
      if (kind === "iso") value = iso(Number(m[2]), Number(m[3]), Number(m[4]));
      else if (kind === "num") {
        const [a, b, y] = [Number(m[2]), Number(m[4]), yr(m[5])];
        const mdy = iso(y, a, b);
        const dmy = iso(y, b, a);
        const prefer = order === "DMY" || m[3] === "." ? [dmy, mdy] : [mdy, dmy];
        const options = prefer.filter((v): v is string => Boolean(v));
        value = (wd && options.find((v) => weekdayOf(v) === wd.slice(0, 3))) || options[0] || null;
      } else if (kind === "mname") value = iso(Number(m[4]), monthNo(m[2]), Number(m[3]));
      else value = iso(yr(m[4]), monthNo(m[3]), Number(m[2]));
      if (!value) continue;
      if (wd && weekdayOf(value) !== wd.slice(0, 3)) mismatch = true;
      hits.push({ index: m.index, length: m[0].length, iso: value, weekday: wd, long: Boolean(wd && new RegExp(`^(${WD_FULL})$`).test(wd)) || kind === "mname" || kind === "dname", mismatch });
    }
  }
  hits.sort((a, b) => a.index - b.index || b.length - a.length);
  return hits.filter((h, i) => !hits.slice(0, i).some((o) => h.index < o.index + o.length && o.index < h.index + h.length));
}

const TIME_RE = /\b(\d{1,2})(?:[:.](\d{2}))?\s*([ap])m\b|\b(\d{1,2})[:.h](\d{2})\b|\b(noon|midnight)\b/gi;

/** Every clock time in a line ("9:30 AM", "9:30AM", "9 AM", "13:30", "9.30", "09h30", "noon"). */
export function findTimes(text: string): TimeHit[] {
  const hits: TimeHit[] = [];
  TIME_RE.lastIndex = 0;
  for (let m = TIME_RE.exec(text); m; m = TIME_RE.exec(text)) {
    if (m[6]) {
      const noon = m[6].toLowerCase() === "noon";
      hits.push({ index: m.index, length: m[0].length, min: noon ? 720 : 0, meridiem: noon ? "p" : "a", hour: noon ? 12 : 0 });
      continue;
    }
    const h = Number(m[1] ?? m[4]);
    const min = Number(m[2] ?? m[5] ?? 0);
    const mer = m[3] ? (m[3].toLowerCase() as "a" | "p") : null;
    if (min > 59) continue;
    if (mer) {
      if (h < 1 || h > 12) continue;
      hits.push({ index: m.index, length: m[0].length, min: ((h % 12) + (mer === "p" ? 12 : 0)) * 60 + min, meridiem: mer, hour: h });
    } else {
      if (h > 24 || (h === 24 && min > 0)) continue;
      hits.push({ index: m.index, length: m[0].length, min: h * 60 + min, meridiem: null, hour: h });
    }
  }
  return hits;
}

/** Resolve a start/end pair where only one side shows AM/PM ("9:30 - 10:00 AM"). */
function resolveRange(a: TimeHit, b: TimeHit): { s: number; e: number } {
  let s = a.min;
  let e = b.min;
  if (!a.meridiem && b.meridiem && a.hour <= 12) {
    const same = ((a.hour % 12) + (b.meridiem === "p" ? 12 : 0)) * 60 + (a.min % 60);
    s = same <= e ? same : (a.hour % 12) * 60 + (a.min % 60);
  } else if (a.meridiem && !b.meridiem && b.hour <= 12) {
    const same = ((b.hour % 12) + (a.meridiem === "p" ? 12 : 0)) * 60 + (b.min % 60);
    e = same >= s ? same : ((b.hour % 12) + 12) * 60 + (b.min % 60);
  }
  return { s, e };
}

/** Kept for compatibility: a single date string → ISO. */
export function parseDateText(s: string, order: DateOrder = "MDY"): string | null {
  const h = findDates(s.trim(), order);
  return h.length === 1 && h[0].index === 0 && h[0].length === s.trim().length ? h[0].iso : null;
}

/** "1:30 PM" / "13:30" / "9.30 a.m." → minutes after midnight. */
export function parseClock(s: string): number | null {
  const t = normalizeText(s);
  const h = findTimes(t);
  return h.length === 1 && h[0].index === 0 && h[0].length === t.length ? h[0].min : null;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/* ------------------------------ line classification ------------------------------ */

const D = "\u0001";
const T = "\u0002";
const SEP = String.raw`\s*(?:-|to|until|till|through)\s*`;
const SK_DT = new RegExp(`^${D}\\s*,?\\s*(?:at\\s+|from\\s+)?${T}${SEP}(?:(${D})\\s*,?\\s*)?${T}(.*)$`, "i");
const SK_T = new RegExp(`^(?:from\\s+)?${T}${SEP}(?:(${D})\\s*,?\\s*)?${T}(.*)$`, "i");
const SK_D = new RegExp(`^${D}\\s*(?:\\(?all[- ]?day(?: event)?\\)?)?$`, "i");
const SK_DD = new RegExp(`^${D}${SEP}${D}\\s*(?:\\(?all[- ]?day(?: event)?\\)?)?$`, "i");
const SK_ALLDAY = /^\(?all[- ]?day(?: event)?\)?$/i;
const SK_ONE_TIME = new RegExp(`^(?:${D}\\s*,?\\s*)?${T}\\s*(?:-|to)?\\s*$`, "i");

type Kind = "datetime" | "time" | "date" | "daterange" | "allday-word" | "heading" | "loose" | "text";

interface Classified {
  kind: Kind;
  dates: DateHit[];
  times: TimeHit[];
  trailing: string;
  hasDateOrTime: boolean;
}

function classify(text: string, order: DateOrder): Classified {
  const dates = findDates(text, order);
  let masked = text;
  for (const d of [...dates].reverse()) masked = masked.slice(0, d.index) + D + " ".repeat(d.length - 1) + masked.slice(d.index + d.length);
  const times = findTimes(masked);
  for (const t of [...times].reverse()) masked = masked.slice(0, t.index) + T + " ".repeat(t.length - 1) + masked.slice(t.index + t.length);
  const sk = masked.replace(/\s+/g, " ").trim();
  const res = (kind: Kind, trailing = ""): Classified => ({ kind, dates, times, trailing: trailing.replace(/^[\s,;:|·•-]+/, "").trim(), hasDateOrTime: dates.length + times.length > 0 });
  let m: RegExpExecArray | null;
  if ((m = SK_DT.exec(sk))) return res("datetime", m[2]);
  if ((m = SK_T.exec(sk))) return res("time", m[2]);
  if (SK_DD.test(sk)) return res("daterange");
  if (SK_D.test(sk)) return res(dates[0].long && !dates[0].weekday?.match(new RegExp(`^(${WD_ABBR})$`)) && !/all/i.test(sk) ? "heading" : "date");
  if (SK_ALLDAY.test(sk)) return res("allday-word");
  // Starts with a date/time but isn't a complete pattern (e.g. a start time without an end).
  if ((sk.startsWith(D) || sk.startsWith(T)) && times.length > 0 && sk.replace(/[\u0001\u0002]/g, "").trim().length < 25) return res("loose");
  if (SK_ONE_TIME.test(sk)) return res("loose");
  return res("text");
}

const LABEL = /^(Location|Organizer|Organiser|Required Attendees|Optional Attendees|Attendees|Resources|Categories|Show time as|Recurrence|Recurrence Pattern|Importance|When|Where|Subject|Start|End|Sent|From|To|Cc):\s*/i;
const BOILERPLATE = /^(_{5,}|-{5,}|microsoft teams meeting$|join:|join (the )?(microsoft teams )?meeting|click here to join|meeting id:|passcode:|password:|dial in by phone|dial-in|phone conference id|find a local number|for organizers|need help\?|meeting options|reset dial-in|https?:\/\/|\+\d[\d\s,#-]{6,})/i;
const TIMEZONE = /^(\(?(utc|gmt)[^)]*\)?|[a-z ]+ (standard|daylight)? ?time( \(.*\))?)$/i;

/* ------------------------------ redaction & shapes ------------------------------ */

/** Remove meeting links, passcodes, meeting IDs, phone numbers and full e-mail addresses. */
export function redact(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\b(passcode|password|pin|meeting id|conference id|phone conference id|access code)\s*:?\s*[^\n;]*/gi, "$1: [hidden]")
    .replace(/\+\d[\d\s().-]{6,}\d(,,\d+#?)?|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b(,,\d+#?)?/g, "[phone]")
    .replace(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "…@$1");
}

const KEEP_WORD = new RegExp(`^(${WD_FULL}|${WD_ABBR}|${MONTH}|am|pm|to|all|day|all-day|canceled|cancelled|noon|midnight|location|organizer|required|optional|attendees|calendar)[.,:;]?$`, "i");

/** A line's shape with all content masked: "Mon 99/9/9999 9:99 AM - 99:99 AM". Safe to copy/share. */
export function maskLine(text: string): string {
  return text
    .split(/(\s+)/)
    .map((tok) => (KEEP_WORD.test(tok) ? tok : tok.replace(/\p{Lu}/gu, "A").replace(/\p{Ll}/gu, "a").replace(/\p{N}/gu, "9").replace(/[^\sAa9.,:;/()|&@#+'-]/g, "·").replace(/a{4,}/g, "aaa").replace(/A{4,}/g, "AAA")))
    .join("")
    .slice(0, 90);
}

/* ------------------------------ parse ------------------------------ */

export interface RejectedLine {
  page: number;
  text: string;
  reason: string;
}

export interface AgendaResult {
  events: CalendarEvent[];
  /** Printed range from the PDF header ("2026-11-01 to 2026-11-07"), else the span of event dates. */
  period: Period | null;
  pages: number;
  dayHeadings: number;
  duplicatesRemoved: { title: string; date: string; start: string | null }[];
  warnings: string[];
  /** Lines that look like a meeting time but couldn't be interpreted (redacted). */
  rejected: RejectedLine[];
  diagnostics: AgendaDiagnostics;
}

interface Anchor {
  top: number; // first line of the date/time block
  idx: number; // last line of the block
  kind: "timed" | "allday";
  date: string | null;
  endDate: string | null;
  s?: number;
  e?: number;
  explicitEndDate?: boolean;
  title: string;
  titleStart: number;
  titleRule: string;
  flags: string[];
  mismatch?: boolean;
}

/** Lines repeated at the top/bottom of most pages (browser headers/footers, page numbers). */
function pageFurniture(lines: PdfLine[]): Set<PdfLine> {
  const drop = new Set<PdfLine>();
  const byPage = new Map<number, PdfLine[]>();
  for (const l of lines) byPage.set(l.page, [...(byPage.get(l.page) ?? []), l]);
  const pages = [...byPage.values()];
  for (const l of lines) if (/^(page\s*)?\d{1,3}\s*(of|\/)\s*\d{1,3}$/i.test(l.text)) drop.add(l);
  // Browser print headers/footers: "11/10/26, 7:30 AM  Calendar - … - Outlook" at the top, the page URL at the bottom.
  for (const pl of pages) {
    const first = pl[0];
    const last = pl[pl.length - 1];
    if (first && /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(\s?[AP]M)?\s+\S/i.test(first.text) && /outlook|calendar/i.test(first.text)) drop.add(first);
    if (last && /^(https?:\/\/|about:blank)\S*(\s+\d{1,3}\s*\/\s*\d{1,3})?$/i.test(last.text)) drop.add(last);
  }
  if (pages.length < 2) return drop;
  const edge = pages.flatMap((pl) => [...pl.slice(0, 2), ...pl.slice(-2)].map((l) => ({ l, key: l.text.replace(/\d+\s*(\/|of)\s*\d+/gi, "#/#") })));
  const counts = new Map<string, Set<number>>();
  for (const { l, key } of edge) counts.set(key, (counts.get(key) ?? new Set()).add(l.page));
  for (const { l, key } of edge) if (counts.get(key)!.size >= Math.max(2, Math.ceil(pages.length * 0.5))) drop.add(l);
  return drop;
}

export function parseAgenda(pages: PdfPageText[], opts: { dateOrder?: DateOrder; ocr?: boolean; stats?: TextStats } = {}): AgendaResult {
  const order = opts.dateOrder ?? "MDY";
  const stats = opts.stats ?? textStats(pages);
  const status = textStatus(stats);
  const all = buildLines(pages);
  const furniture = pageFurniture(all);
  const lines = all.filter((l) => !furniture.has(l));
  const cls = lines.map((l) => classify(l.text, order));

  const diag: AgendaDiagnostics = {
    method: opts.ocr ? "ocr" : "text",
    stats,
    status,
    lines: lines.length,
    dayHeadings: 0,
    dateTimeLines: cls.filter((c) => c.hasDateOrTime).length,
    layout: "none",
    candidates: 0,
    parsed: 0,
    flagged: 0,
    rejected: 0,
    rejections: {},
    titleRules: {},
    shapes: [],
  };
  if (opts.ocr) {
    const confs = lines.map((l) => l.conf).filter((c): c is number => typeof c === "number");
    diag.ocr = { pages: pages.length, meanConfidence: confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : 0, lowConfidenceLines: confs.filter((c) => c < 70).length };
  }
  if (!opts.ocr && status === "no-text") throw new AgendaError("no-text", NO_TEXT_MESSAGE, diag);
  if (!opts.ocr && status === "undecodable") throw new AgendaError("undecodable", UNDECODABLE_MESSAGE, diag);
  if (lines.length === 0) throw new AgendaError("no-text", NO_TEXT_MESSAGE, diag);

  // A line in day-heading form is an event's own date line when a title-sized line sits right above it.
  for (let i = 0; i < lines.length; i++) {
    if (cls[i].kind !== "heading") continue;
    const above = lines[i - 1];
    if (above && cls[i - 1].kind === "text" && above.size > lines[i].size + 0.4 && !LABEL.test(above.text)) cls[i] = { ...cls[i], kind: "date" };
  }
  const isHeading = (i: number) => cls[i]?.kind === "heading";
  diag.dayHeadings = cls.filter((c) => c.kind === "heading").length;

  // Choose the layout: date+time on one line (new Outlook), or times whose date comes from a separate
  // date line or the day heading (other versions). In the first layout, bare time ranges are body text.
  const nDT = cls.filter((c) => c.kind === "datetime").length;
  const nT = cls.filter((c) => c.kind === "time").length;
  const timeOnly = nDT === 0 || nT > nDT * 2;
  diag.layout = nDT && !timeOnly ? "date+time on one line" : nT ? (nDT ? "mixed" : "time lines under dates/day headings") : "none";

  const rejected: RejectedLine[] = [];
  const reject = (i: number, reason: string) => {
    rejected.push({ page: lines[i].page, text: redact(lines[i].text).slice(0, 160), reason });
    diag.rejections[reason] = (diag.rejections[reason] ?? 0) + 1;
  };

  // In the time-column layout, real meeting times share the left column; indented times are body text.
  const timeXs = cls.map((c, i) => (c.kind === "time" ? lines[i].x : NaN)).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  const timeCol = timeXs.length ? timeXs[Math.floor(timeXs.length / 4)] : 0;

  // "Date line + time line" layout: when most time lines sit under their own date line, a time line
  // without one is description text (e.g. "9:00 - 9:15 Introductions"), not a meeting.
  const timeIdx = cls.map((c, i) => (c.kind === "time" ? i : -1)).filter((i) => i >= 0);
  const withDateAbove = timeIdx.filter((i) => cls[i - 1]?.kind === "date" && lines[i - 1].page === lines[i].page).length;
  const needDateLine = timeOnly && timeIdx.length > 0 && withDateAbove >= timeIdx.length * 0.6;
  // Dates printed before the first day heading on page 1 are the report header (printed range), not events.
  const firstHeading = cls.findIndex((c) => c.kind === "heading");
  const inHeader = (i: number) => firstHeading > 0 && i < firstHeading && lines[i].page === lines[0].page;

  // Pass 1: anchors (date/time blocks) with their dates.
  const anchors: Anchor[] = [];
  const used = new Set<number>();
  let ctxDate: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const c = cls[i];
    if (c.kind === "heading") {
      ctxDate = c.dates[0].iso;
      continue;
    }
    if (used.has(i)) continue;
    const base = { titleStart: i, title: "", titleRule: "", flags: [] as string[] };
    if (c.kind === "datetime") {
      diag.candidates++;
      const { s, e } = resolveRange(c.times[0], c.times[1]);
      anchors.push({ ...base, top: i, idx: i, kind: "timed", date: c.dates[0].iso, endDate: c.dates[1]?.iso ?? null, explicitEndDate: Boolean(c.dates[1]), s, e, mismatch: c.dates.some((d) => d.mismatch) });
      ctxDate = c.dates[0].iso;
    } else if (c.kind === "time" && timeOnly && lines[i].x <= timeCol + Math.max(12, lines[i].size * 3)) {
      diag.candidates++;
      const { s, e } = resolveRange(c.times[0], c.times[1]);
      // Date from a date line directly above (same block), else the current day heading.
      const prev = cls[i - 1];
      const dateAbove = prev && prev.kind === "date" && !used.has(i - 1) && lines[i - 1].page === lines[i].page ? i - 1 : -1;
      const date = dateAbove >= 0 ? prev.dates[0].iso : ctxDate;
      if (needDateLine && dateAbove < 0) continue; // description text
      if (!date) {
        reject(i, "time without a date");
        continue;
      }
      if (dateAbove >= 0) used.add(dateAbove);
      anchors.push({ ...base, top: dateAbove >= 0 ? dateAbove : i, idx: i, kind: "timed", date, endDate: c.dates[0]?.iso ?? null, explicitEndDate: Boolean(c.dates[0]), s, e, title: "", mismatch: dateAbove >= 0 && prev.dates[0].mismatch });
      // Classic layout: the title is printed beside the time.
      if (c.trailing && !TIMEZONE.test(c.trailing)) Object.assign(anchors[anchors.length - 1], { title: c.trailing, titleRule: "beside the time" });
    } else if (c.kind === "date" || c.kind === "daterange") {
      // A date line followed by a time line belongs to that time (handled above).
      if (timeOnly && cls[i + 1]?.kind === "time") continue;
      const next = cls[i + 1];
      if (next?.kind === "loose") continue; // reported with the loose line
      if (inHeader(i)) continue;
      anchors.push({ ...base, top: i, idx: i, kind: "allday", date: c.dates[0].iso, endDate: c.dates[1]?.iso ?? null, mismatch: c.dates.some((d) => d.mismatch) });
    } else if (c.kind === "allday-word" && ctxDate) {
      anchors.push({ ...base, top: i, idx: i, kind: "allday", date: ctxDate, endDate: null });
    } else if (c.kind === "loose") {
      diag.candidates++;
      reject(i, c.times.length === 1 ? "start time without an end time" : "unrecognised date/time layout");
    }
  }

  // Pass 2: titles.
  const anchorLines = new Set(anchors.flatMap((a) => [a.top, a.idx]));
  const sameRow = (a: PdfLine, b: PdfLine) => a.page === b.page && Math.abs(a.y - b.y) < 0.5;
  const adjacent = (upper: PdfLine, lower: PdfLine, gapFactor: number) =>
    upper.page === lower.page ? upper.y - lower.y <= Math.max(upper.size, lower.size) * gapFactor : lines.findIndex((l) => l.page === lower.page) === lines.indexOf(lower) && lower.page === upper.page + 1;
  // Pages are consecutive in the PDF (not separated by a page that wasn't read).
  const pagesConsecutive = (upper: PdfLine, lower: PdfLine) => lower.page === upper.page + 1 && lines.findIndex((l) => l.page === lower.page) === lines.indexOf(lower);
  const titleish = (j: number) => j >= 0 && cls[j].kind === "text" && !isHeading(j) && !anchorLines.has(j) && !LABEL.test(lines[j].text) && !BOILERPLATE.test(lines[j].text);
  for (const a of anchors) {
    const block = lines[a.top];
    const j = a.top - 1;
    const above = lines[j];
    let rule = "";
    if (a.title) rule = a.titleRule;
    else if (titleish(j) && !sameRow(above, block)) {
      if (opts.ocr) rule = adjacent(above, block, 3) ? "ocr: line above" : "";
      else if (above.size > block.size + 0.4 && (above.page === block.page || pagesConsecutive(above, block))) rule = "larger font";
      else if (above.font !== block.font && above.size >= block.size - 0.3 && adjacent(above, block, 2.2)) rule = "bold/other font";
      else if (adjacent(above, block, 2.2) && above.text.length <= 200) rule = "line above (uncertain)";
    }
    if (!rule && !a.title && cls[a.idx].trailing && !TIMEZONE.test(cls[a.idx].trailing)) {
      a.title = cls[a.idx].trailing;
      rule = "beside the time";
    }
    if (rule && !a.title) {
      let start = j;
      while (start - 1 >= 0 && a.top - start < 5) {
        const prev = lines[start - 1];
        const cur = lines[start];
        // Text recognition measures sizes from line boxes, which grow with ascenders/descenders, so allow
        // ±40% there (the tight line spacing below still separates a title from the text above it);
        // PDFs need the same size and font.
        const sameSize = opts.ocr ? Math.abs(prev.size - above.size) <= Math.max(prev.size, above.size) * 0.4 : Math.abs(prev.size - above.size) <= 0.3 && prev.font === above.font;
        if (!titleish(start - 1) || !sameSize || !adjacent(prev, cur, 1.8)) break;
        start--;
      }
      a.titleStart = start;
      a.title = lines.slice(start, a.top).map((l) => l.text).join(" ").replace(/\s+/g, " ").trim();
    }
    if (!rule) {
      rule = "not found";
      a.flags.push("No meeting title was found next to this time — add a description.");
    } else if (rule === "line above (uncertain)") a.flags.push("The title was taken from the line above the time — check it.");
    a.titleRule = rule;
  }
  // All-day lines without a title are page/date text (e.g. a printed date), not events.
  const kept = anchors.filter((a) => a.kind === "timed" || (a.title && a.titleRule !== "not found" && a.titleRule !== "line above (uncertain)"));
  for (const a of kept) diag.titleRules[a.titleRule] = (diag.titleRules[a.titleRule] ?? 0) + 1;

  // Pass 3: build events.
  const events: CalendarEvent[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, CalendarEvent>();
  const duplicatesRemoved: AgendaResult["duplicatesRemoved"] = [];
  kept.forEach((a, k) => {
    const bodyEnd = k + 1 < kept.length ? kept[k + 1].titleStart : lines.length;
    const body = lines.slice(a.idx + 1, bodyEnd).filter((_, n) => !isHeading(a.idx + 1 + n));
    const { organizer, location, domains } = details(body);
    const title = a.title || `Meeting at ${a.s !== undefined ? hhmm(a.s) : "?"} (title not found)`;
    const canceled = /^\s*cancel+ed\s*:/i.test(title);
    const timeLine = lines.slice(a.top, a.idx + 1).map((l) => l.text).join(" ");
    const src = redact([title, timeLine, location && `Location: ${location}`, organizer && `Organizer: ${organizer}`].filter(Boolean).join("\n"));
    const flags = [...a.flags];
    if (a.mismatch) flags.push("The weekday printed in the PDF doesn't match the date — check the date.");
    if (opts.ocr) {
      const conf = Math.min(...lines.slice(a.titleStart, a.idx + 1).map((l) => l.conf ?? 100));
      flags.unshift(`Read with text recognition${conf < 70 ? " (low confidence)" : ""} — compare the title, date and times with your calendar.`);
    }
    const parseNotes = flags.map((message) => ({ code: "pdf-check" as const, message }));
    const base = { title, description: "", location: location ?? "", canceled, recurring: false, source: "pdf" as const, sourceLabel: `PDF page ${lines[a.idx].page}`, organizer, domains, sourceText: src, ...(parseNotes.length ? { parseNotes } : {}) };

    if (a.kind === "allday") {
      const d1 = a.date!;
      const d2 = a.endDate ?? d1;
      const key = `allday|${title.toLowerCase()}|${d1}|${d2}`;
      if (seen.has(key)) return; // Outlook repeats multi-day events under every day
      const ev: CalendarEvent = { ...base, date: d1, endDate: d2 !== d1 ? d2 : undefined, start: null, end: null, minutes: null, allDay: true, status: canceled ? "free" : "busy" };
      seen.set(key, ev);
      events.push(ev);
      return;
    }

    const startDate = a.date!;
    const s = a.s!;
    const e = a.e!;
    const endDate = a.endDate ?? startDate;
    // End on a later day: explicit second date, or an end time before the start (e.g. 11:00 PM - 1:00 AM).
    const nextDay = endDate > startDate || (!a.explicitEndDate && e <= s && !(e === 0 && s > 0));
    const realEndDate = a.explicitEndDate ? endDate : nextDay ? addDays(startDate, 1) : startDate;
    const key = `${title.toLowerCase()}|${startDate}|${s}|${realEndDate}|${e}`;
    if (seen.has(key)) {
      duplicatesRemoved.push({ title, date: startDate, start: hhmm(s) });
      return;
    }
    if (realEndDate < startDate || (realEndDate === startDate && e < s)) {
      reject(a.idx, "ends before it starts");
      return;
    }
    const total = realEndDate > startDate ? 24 * 60 - s + e + (Math.round((Date.parse(realEndDate) - Date.parse(startDate)) / 864e5) - 1) * 24 * 60 : (e === 0 ? 24 * 60 : e) - s;
    if (total <= 0) {
      reject(a.idx, "zero-length meeting");
      return;
    }
    if (total > 12 * 60) parseNotes.push({ code: "pdf-check", message: `This meeting is ${Math.round(total / 6) / 10} hours long — check the times.` });
    const notesNow = parseNotes.length ? { parseNotes } : {};
    const common = { ...base, ...notesNow, status: canceled ? ("free" as const) : ("busy" as const), allDay: false };
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

  // Masked shapes of date/time lines (recognised or not) + the first lines of page 1, for diagnostics.
  const shapeIdx = new Set<number>();
  lines.slice(0, 3).forEach((_, i) => shapeIdx.add(i));
  cls.forEach((c, i) => {
    if (shapeIdx.size < 14 && c.hasDateOrTime && c.kind !== "text") shapeIdx.add(i);
  });
  cls.forEach((c, i) => {
    if (shapeIdx.size < 18 && c.hasDateOrTime && c.kind === "text" && /^[\d(]|^\p{L}{2,9}\.?,?\s+\d/u.test(lines[i].text)) shapeIdx.add(i);
  });
  diag.shapes = [...shapeIdx].sort((a, b) => a - b).map((i) => `p${lines[i].page} ${cls[i].kind.padEnd(9)} ${lines[i].size}pt  ${maskLine(lines[i].text)}`);
  const timedEvents = events.filter((e) => !e.allDay);
  diag.parsed = new Set(timedEvents.map((e) => `${e.title}|${e.date}|${e.start}`)).size;
  diag.flagged = events.filter((e) => e.parseNotes?.length).length;
  diag.rejected = rejected.length;

  if (timedEvents.length === 0) {
    const allDayOnly = events.length > 0;
    if (!allDayOnly) {
      const gridLike = cls.some((c) => c.times.length > 0) && nDT === 0 && nT === 0;
      throw new AgendaError(
        "unrecognized",
        UNRECOGNIZED_MESSAGE + (gridLike ? " If you printed the day/week/month calendar grid, print again with “Print detailed agenda” ticked." : ""),
        diag,
      );
    }
  }

  // Printed range header (first lines), else the span of event dates.
  let period: Period | null = null;
  for (let i = 0; i < Math.min(12, lines.length); i++) {
    if (cls[i].kind === "daterange" && (inHeader(i) || !kept.some((a) => a.top === i))) {
      const [a, b] = [cls[i].dates[0].iso, cls[i].dates[1].iso];
      if (a <= b) period = { start: a, end: b };
      break;
    }
  }
  if (!period && events.length) {
    const ds = events.map((e) => e.date).sort();
    period = { start: ds[0], end: ds[ds.length - 1] };
  }
  events.sort((a, b) => (a.date + (a.start ?? "")).localeCompare(b.date + (b.start ?? "")));
  dropOwnDomain(events);
  if (rejected.length) warnings.push(`${rejected.length} line${rejected.length === 1 ? "" : "s"} looked like a meeting time but couldn't be interpreted.`);
  return { events, period, pages: pages.length, dayHeadings: diag.dayHeadings, duplicatesRemoved, warnings, rejected, diagnostics: diag };
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
      if ((name === "organizer" || name === "organiser") && !organizer) organizer = value.replace(/<[^>]*>/g, "").trim() || undefined;
      if (name === "location" && !location) location = value.slice(0, 120) || undefined;
      if (inAttendees || name === "organizer" || name === "organiser") collect(value, domains);
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

/** Diagnostics as plain text for the "Copy diagnostics" button — counts and masked shapes only. */
export function diagnosticsText(d: AgendaDiagnostics, extra: Record<string, string | number | undefined> = {}): string {
  const s = d.stats;
  const rows: [string, unknown][] = [
    ["method", d.method],
    ["text status", d.status],
    ["pages", s?.pages],
    ["pages with text", s?.pagesWithText],
    ["text items", s?.textItems],
    ["non-empty items", s?.nonEmptyItems],
    ["characters", s?.characters],
    ["readable ratio", s?.readableRatio],
    ["fonts", s?.fonts],
    ["page errors", s?.pageErrors],
    ["producer", s?.producer],
    ["creator", s?.creator],
    ["lines", d.lines],
    ["day headings", d.dayHeadings],
    ["date/time lines", d.dateTimeLines],
    ["layout", d.layout],
    ["candidate meetings", d.candidates],
    ["parsed meetings", d.parsed],
    ["flagged", d.flagged],
    ["rejected", d.rejected],
    ["rejection reasons", Object.entries(d.rejections).map(([k, v]) => `${k}: ${v}`).join("; ") || "—"],
    ["title rules", Object.entries(d.titleRules).map(([k, v]) => `${k}: ${v}`).join("; ") || "—"],
    ...(d.ocr ? ([["OCR mean confidence", d.ocr.meanConfidence], ["OCR low-confidence lines", d.ocr.lowConfidenceLines]] as [string, unknown][]) : []),
    ...Object.entries(extra),
  ];
  return [...rows.filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}: ${v}`), "line shapes (content masked):", ...d.shapes.map((x) => "  " + x)].join("\n");
}
