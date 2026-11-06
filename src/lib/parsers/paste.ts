import type { CalendarEvent, Period, Settings } from "../types";
import { intervalMinutes, isValidISODate } from "../time";
import { parseCalendarCsv } from "./csv";

/**
 * Parse calendar information pasted as text:
 * - rows copied from an Outlook list view / spreadsheet (with a Subject/Start header) → CSV parser
 * - agenda-style text such as
 *     Monday, November 2, 2026
 *     9:00 AM - 10:30 AM  Acme | Planning | Model build
 *     11/03/2026 1:00 PM–2:15 PM Globex sync
 *     9:30 - 10:00
 *     Weekly status            ← title on the line after a time range
 * Lines without an explicit time range never get invented times.
 */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAY = "(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\\.?";

const TIME = "(\\d{1,2})(?::(\\d{2}))?\\s*([ap])?\\.?\\s*m?\\.?";
export const TIME_RANGE = new RegExp(`(?<![\\d:])${TIME}\\s*(?:-|–|—|to|until)\\s*${TIME}(?![\\d:])`, "i");

export function parseTimeRange(text: string): { start: string; end: string; index: number; length: number } | null {
  const m = TIME_RANGE.exec(text);
  if (!m) return null;
  let [sh, sm, sap, eh, em, eap] = [Number(m[1]), Number(m[2] ?? 0), m[3]?.toLowerCase(), Number(m[4]), Number(m[5] ?? 0), m[6]?.toLowerCase()];
  if (sh > 24 || eh > 24 || sm > 59 || em > 59) return null;
  // A bare "9 - 10" with no minutes and no am/pm is too ambiguous (could be a date range or count).
  if (m[2] === undefined && m[5] === undefined && !sap && !eap) return null;
  const to24 = (h: number, ap?: string) => (ap === "p" && h < 12 ? h + 12 : ap === "a" && h === 12 ? 0 : h);
  if (!sap && eap) {
    // "9:30 - 10:30 AM" / "11 - 1 PM"
    const asSame = to24(sh, eap);
    const end = to24(eh, eap);
    sap = asSame <= end ? eap : eap === "p" ? "a" : "p";
  }
  if (sap && !eap) eap = sap;
  let s = to24(sh, sap);
  let e = to24(eh, eap);
  if (!sap && !eap && e < s && e < 12) e += 12; // "11:00 - 1:00" (24h text without markers)
  if (e <= s && !(e === 0 && s > 0)) return null;
  if (e === 0) e = 24;
  const fmt = (h: number, mm: number) => `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  return { start: fmt(s, sm), end: fmt(e, em), index: m.index, length: m[0].length };
}

/** Find a date in text; returns ISO date. Year defaults to the period's year (closest match). */
export function findDate(text: string, period: Period, order: Settings["csvDateOrder"]): { date: string; index: number; length: number } | null {
  const yearOf = (y?: string) => (y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : Number(period.start.slice(0, 4)));
  const mk = (y: number, mo: number, d: number) => {
    const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return isValidISODate(iso) ? iso : null;
  };
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (m) {
    const d = mk(Number(m[1]), Number(m[2]), Number(m[3]));
    if (d) return { date: d, index: m.index, length: m[0].length };
  }
  m = /(?<![\d:])(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?(?![\d:])/.exec(text);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const [mo, d] = order === "DMY" || a > 12 ? [b, a] : [a, b];
    const date = mk(yearOf(m[3]), mo, d);
    if (date) return { date, index: m.index, length: m[0].length };
  }
  m = new RegExp(`(?:${WEEKDAY},?\\s+)?(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, "i").exec(text);
  if (m) {
    const date = mk(yearOf(m[3]), MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)) + 1, Number(m[2]));
    if (date) return { date, index: m.index, length: m[0].length };
  }
  m = new RegExp(`(?:${WEEKDAY},?\\s+)?(\\d{1,2})\\s+(${MONTHS.join("|")})[a-z]*\\.?(?:\\s+(\\d{4}))?`, "i").exec(text);
  if (m) {
    const date = mk(yearOf(m[3]), MONTHS.indexOf(m[2].toLowerCase().slice(0, 3)) + 1, Number(m[1]));
    if (date) return { date, index: m.index, length: m[0].length };
  }
  return null;
}

function stripDecor(s: string): string {
  return s.replace(/^[\s,;:|•·\-–—]+|[\s,;:|•·\-–—]+$/g, "").replace(/\s{2,}/g, " ").trim();
}

export interface PasteResult {
  events: CalendarEvent[];
  warnings: string[];
  format: string;
}

export function parsePastedEvents(text: string, period: Period, settings: Pick<Settings, "csvDateOrder">): PasteResult {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) return { events: [], warnings: [], format: "empty" };
  const firstLine = trimmed.split(/\r?\n/)[0].toLowerCase();
  if (/(subject|title)/.test(firstLine) && /(start)/.test(firstLine) && /[\t,]/.test(firstLine)) {
    const r = parseCalendarCsv(trimmed, period, settings, "pasted rows");
    return { events: r.events.map((e) => ({ ...e, source: "paste" })), warnings: r.warnings, format: "table" };
  }
  const events: CalendarEvent[] = [];
  const warnings: string[] = [];
  let currentDate: string | null = null;
  let pending: { start: string; end: string; date: string | null } | null = null;
  const lines = trimmed.split(/\r?\n/);
  const push = (title: string, date: string | null, start: string | null, end: string | null, lineNo: number) => {
    const t = stripDecor(title);
    if (!t) return;
    if (!date) warnings.push(`Line ${lineNo}: no date found for “${t}” — set the date in review.`);
    events.push({
      title: t,
      description: "",
      location: "",
      date: date ?? "",
      start,
      end,
      minutes: start && end ? intervalMinutes(start, end) : null,
      allDay: false,
      canceled: /^\s*cancel+ed\s*:/i.test(t),
      status: /tentative/i.test(t) ? "tentative" : "busy",
      recurring: false,
      source: "paste",
      sourceLabel: "pasted text",
    });
  };
  lines.forEach((raw, i) => {
    const line = raw.replace(/\t+/g, "  ").trim();
    if (!line) return;
    const d = findDate(line, period, settings.csvDateOrder);
    const tr = parseTimeRange(line);
    let rest = line;
    if (tr) rest = rest.slice(0, tr.index) + " " + rest.slice(tr.index + tr.length);
    if (d) {
      const di = rest.indexOf(line.slice(d.index, d.index + d.length));
      if (di >= 0) rest = rest.slice(0, di) + " " + rest.slice(di + d.length);
    }
    rest = stripDecor(rest.replace(new RegExp(`^${WEEKDAY}\\b`, "i"), ""));
    if (d && !tr && !rest) {
      currentDate = d.date; // date header line
      pending = null;
      return;
    }
    const date = d?.date ?? currentDate;
    if (tr && !rest) {
      pending = { start: tr.start, end: tr.end, date };
      return;
    }
    if (tr) {
      push(rest, date, tr.start, tr.end, i + 1);
      pending = null;
      return;
    }
    if (pending) {
      push(rest, pending.date, pending.start, pending.end, i + 1);
      pending = null;
      return;
    }
    if (rest && /[a-z]{3,}/i.test(rest)) {
      push(rest, date, null, null, i + 1);
      if (d) currentDate = d.date;
    }
  });
  const inPeriod = events.filter((e) => !e.date || (e.date >= period.start && e.date <= period.end));
  if (inPeriod.length < events.length) warnings.push(`${events.length - inPeriod.length} pasted event(s) fall outside the timesheet period and were skipped.`);
  return { events: inPeriod, warnings, format: "text" };
}
