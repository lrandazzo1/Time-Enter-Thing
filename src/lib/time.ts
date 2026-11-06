/** Time, date and decimal-hour helpers. All hour math is done in minutes and rounded once at the end. */

/** Minutes -> decimal hours string with exactly two decimals, e.g. 210 -> "3.50". */
export function formatDecimalHours(minutes: number): string {
  if (!Number.isFinite(minutes)) return "0.00";
  // Round half-up on hundredths of an hour; epsilon guards float noise (e.g. 1.005).
  const hundredths = Math.round((minutes / 60) * 100 + 1e-9);
  return (hundredths / 100).toFixed(2);
}

/** Hundredths-of-an-hour as an integer, for exact summing of displayed values. */
export function hundredths(minutes: number): number {
  return Math.round((minutes / 60) * 100 + 1e-9);
}

/**
 * Parse a user-typed hours value into minutes.
 * Accepts decimals ("1.5", "1.50", ".75") and H:MM ("1:30" -> 90) so people who type clock
 * notation still get correct decimal output. Returns null when invalid.
 */
export function parseHoursInput(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (!s) return null;
  const hm = /^(\d{1,3}):([0-5]\d)$/.exec(s);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  if (/^\d{0,3}(\.\d{0,4})?$/.test(s) && s !== ".") {
    const n = Number(s);
    if (Number.isFinite(n)) return n * 60;
  }
  return null;
}

/** "HH:MM" -> minutes after midnight. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(total: number): string {
  const t = Math.max(0, Math.min(24 * 60, Math.round(total)));
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function isValidHHMM(s: string): boolean {
  return /^([01]\d|2[0-4]):[0-5]\d$/.test(s) && toMinutes(s) <= 24 * 60;
}

/** Duration in minutes between two HH:MM values on the same day (end may be 24:00). */
export function intervalMinutes(start: string, end: string): number {
  return toMinutes(end) - toMinutes(start);
}

/** "YYYY-MM-DD" validation including real calendar dates. */
export function isValidISODate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && y >= 1990 && y <= 2100;
}

/** "YYYY-MM-DD" -> "MM/DD/YYYY" */
export function toUSDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday */
export function dayOfWeek(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function weekdayLabel(iso: string): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayOfWeek(iso)];
}

export function prettyDate(iso: string): string {
  if (!isValidISODate(iso)) return iso || "—";
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${weekdayLabel(iso)} ${months[m - 1]} ${d}, ${y}`;
}

/** Today's date in the given IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return instantToZoned(now, timeZone).date;
}

/** Monday of the week containing `iso`. */
export function mondayOf(iso: string): string {
  const dow = dayOfWeek(iso);
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

export function listDates(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard++ < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/* ---------------- Time zone conversion (Intl based, DST-correct) ---------------- */

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    dtf(tz);
    return true;
  } catch {
    return false;
  }
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsOf(date: Date, timeZone: string): WallParts {
  const p: Record<string, number> = {};
  for (const part of dtf(timeZone).formatToParts(date)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour === 24 ? 0 : p.hour, minute: p.minute, second: p.second };
}

/** Absolute instant -> wall-clock date/time in a zone. */
export function instantToZoned(date: Date, timeZone: string): { date: string; time: string } {
  const p = partsOf(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** Wall-clock time in a zone -> absolute instant (handles DST; ambiguous times resolve to the first occurrence). */
export function zonedToInstant(w: WallParts, timeZone: string): Date {
  const asUTC = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  let guess = asUTC;
  for (let i = 0; i < 3; i++) {
    const p = partsOf(new Date(guess), timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = asUTC - seen;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
  } catch {
    return "America/Chicago";
  }
}
