import ICAL from "ical.js";
import type { BusyStatus, CalendarEvent, Period } from "../types";
import { addDays, instantToZoned, isValidTimeZone, zonedToInstant } from "../time";
import { resolveTzid } from "../windowsZones";

type ICALTime = InstanceType<typeof ICAL.Time>;
type ICALComponent = InstanceType<typeof ICAL.Component>;
type ICALEvent = InstanceType<typeof ICAL.Event>;

const MAX_OCCURRENCES_PER_SERIES = 3000;

export interface IcsParseResult {
  events: CalendarEvent[];
  warnings: string[];
}

/**
 * Parse an iCalendar (.ics) export — Outlook desktop "Save Calendar", Outlook on the web
 * published calendars, Google/Apple exports. Expands recurring series (RRULE/RDATE/EXDATE,
 * RECURRENCE-ID overrides) within the period and converts every time to `timeZone`.
 */
export function parseIcs(text: string, period: Period, timeZone: string, sourceLabel?: string): IcsParseResult {
  const warnings: string[] = [];
  let root: ICALComponent;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch (e) {
    throw new Error(`This file is not a valid .ics calendar (${(e as Error).message}).`);
  }
  const method = String(root.getFirstPropertyValue("method") ?? "").toUpperCase();

  for (const vtz of root.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(vtz);
    } catch {
      /* ignore malformed VTIMEZONE; we fall back to TZID name mapping */
    }
  }

  const rangeStart = zonedToInstant(wall(period.start, 0, 0), timeZone).getTime() - 864e5;
  const rangeEnd = zonedToInstant(wall(addDays(period.end, 1), 0, 0), timeZone).getTime() + 864e5;

  const vevents = root.getAllSubcomponents("vevent");
  const masters = new Map<string, ICALEvent>();
  const exceptions: ICALEvent[] = [];
  for (const comp of vevents) {
    const ev = new ICAL.Event(comp);
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid || `__nouid_${masters.size}`, ev);
  }
  const orphans: ICALEvent[] = [];
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master && master.isRecurring()) master.relateException(ex);
    else orphans.push(ex);
  }

  const out: CalendarEvent[] = [];
  const emit = (item: ICALEvent, start: ICALTime, end: ICALTime, recurring: boolean, tzidSource: ICALEvent) => {
    const comp = item.component;
    const tzStart = paramTzid(tzidSource.component, "dtstart");
    const tzEnd = paramTzid(tzidSource.component, "dtend") ?? tzStart;
    const title = (item.summary || "").trim();
    const allDay = start.isDate;
    let status = busyStatus(comp);
    const canceled =
      method === "CANCEL" ||
      String(comp.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED" ||
      /^\s*cancel+ed\s*:/i.test(title);
    if (canceled) status = "free";
    const domains = emailDomains(comp);

    let ev: CalendarEvent;
    if (allDay) {
      ev = {
        title,
        description: clip(item.description),
        location: clip(item.location, 300),
        date: isoFromICAL(start),
        start: null,
        end: null,
        minutes: null,
        allDay: true,
        canceled,
        status,
        recurring,
        domains,
        source: "ics",
        sourceLabel,
      };
    } else {
      const s = toInstant(start, tzStart, timeZone);
      const e = toInstant(end, tzEnd, timeZone);
      if (e.getTime() < rangeStart || s.getTime() > rangeEnd) return;
      const zs = instantToZoned(s, timeZone);
      const ze = instantToZoned(e, timeZone);
      let endTime = ze.time;
      let crosses = false;
      if (ze.date > zs.date) {
        if (ze.date === addDays(zs.date, 1) && ze.time === "00:00") endTime = "24:00";
        else {
          endTime = "24:00";
          crosses = true;
        }
      }
      const minutes = Math.max(0, Math.round((Math.min(e.getTime(), zonedToInstant(wall(addDays(zs.date, 1), 0, 0), timeZone).getTime()) - s.getTime()) / 60000));
      ev = {
        title,
        description: clip(item.description),
        location: clip(item.location, 300),
        date: zs.date,
        start: zs.time,
        end: endTime,
        minutes,
        allDay: false,
        canceled,
        status,
        recurring,
        crossesMidnight: crosses,
        domains,
        source: "ics",
        sourceLabel,
      };
    }
    if (ev.date >= period.start && ev.date <= period.end) out.push(ev);
  };

  for (const ev of [...masters.values(), ...orphans]) {
    if (!ev.startDate) continue;
    try {
      if (ev.isRecurring()) {
        const it = ev.iterator();
        let n = 0;
        for (let next = it.next(); next; next = it.next()) {
          if (++n > MAX_OCCURRENCES_PER_SERIES) {
            warnings.push(`Stopped expanding "${ev.summary}" after ${MAX_OCCURRENCES_PER_SERIES} occurrences.`);
            break;
          }
          const tz = paramTzid(ev.component, "dtstart");
          const inst = next.isDate ? Date.UTC(next.year, next.month - 1, next.day) : toInstant(next, tz, timeZone).getTime();
          if (inst > rangeEnd) break;
          const details = ev.getOccurrenceDetails(next);
          const item = details.item as ICALEvent;
          if (inst < rangeStart - 7 * 864e5 && item === ev) continue;
          emit(item, details.startDate, details.endDate, true, item === ev ? ev : item);
        }
      } else {
        emit(ev, ev.startDate, ev.endDate ?? ev.startDate, false, ev);
      }
    } catch (e) {
      warnings.push(`Skipped "${ev.summary || "untitled event"}": ${(e as Error).message}`);
    }
  }

  out.sort((a, b) => (a.date + (a.start ?? "")).localeCompare(b.date + (b.start ?? "")));
  dropOwnDomain(out);
  return { events: out, warnings };
}

const GENERIC_DOMAINS = new Set(["gmail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "msn.com", "protonmail.com", "resource.calendar.google.com"]);

function emailDomains(comp: ICALComponent): string[] {
  const out = new Set<string>();
  for (const name of ["organizer", "attendee"]) {
    for (const prop of comp.getAllProperties(name)) {
      const v = String(prop.getFirstValue() ?? "");
      const m = /@([a-z0-9.-]+\.[a-z]{2,})/i.exec(v);
      if (m && !GENERIC_DOMAINS.has(m[1].toLowerCase())) out.add(m[1].toLowerCase());
    }
  }
  return [...out];
}

/** The user's own company domain appears on almost every meeting; drop it so it isn't used as a client hint. */
function dropOwnDomain(events: CalendarEvent[]) {
  const counts = new Map<string, number>();
  const withDomains = events.filter((e) => e.domains?.length);
  for (const e of withDomains) for (const d of e.domains!) counts.set(d, (counts.get(d) ?? 0) + 1);
  const own = [...counts].filter(([, n]) => withDomains.length >= 3 && n / withDomains.length >= 0.6).map(([d]) => d);
  if (!own.length) return;
  for (const e of events) if (e.domains) e.domains = e.domains.filter((d) => !own.includes(d));
}

function wall(iso: string, hour: number, minute: number) {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day, hour, minute, second: 0 };
}

function isoFromICAL(t: ICALTime): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
}

function paramTzid(comp: ICALComponent, prop: string): string | null {
  const p = comp.getFirstProperty(prop);
  const v = p?.getParameter("tzid");
  return typeof v === "string" ? v : Array.isArray(v) ? String(v[0]) : null;
}

/** Convert an ICAL.Time (with its TZID) to an absolute instant. */
function toInstant(t: ICALTime, tzid: string | null, fallbackZone: string): Date {
  const parts = { year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second };
  const zoneId = t.zone?.tzid;
  if (zoneId === "UTC" || zoneId === "Z") return new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second));
  const iana = resolveTzid(tzid, isValidTimeZone);
  if (iana) return zonedToInstant(parts, iana);
  if (tzid && zoneId && zoneId !== "floating" && ICAL.TimezoneService.has(tzid)) return new Date(t.toUnixTime() * 1000);
  return zonedToInstant(parts, fallbackZone); // floating time: interpret in the user's zone
}

function busyStatus(comp: ICALComponent): BusyStatus {
  const ms = String(comp.getFirstPropertyValue("x-microsoft-cdo-busystatus") ?? "").toUpperCase();
  if (ms === "TENTATIVE") return "tentative";
  if (ms === "FREE") return "free";
  if (ms === "OOF") return "oof";
  if (ms === "WORKINGELSEWHERE") return "elsewhere";
  if (ms === "BUSY") return "busy";
  const status = String(comp.getFirstPropertyValue("status") ?? "").toUpperCase();
  if (status === "TENTATIVE") return "tentative";
  const transp = String(comp.getFirstPropertyValue("transp") ?? "").toUpperCase();
  if (transp === "TRANSPARENT") return "free";
  return transp === "OPAQUE" || status === "CONFIRMED" ? "busy" : "unknown";
}

function clip(s: string | null | undefined, max = 2000): string {
  const t = (s ?? "").replace(/\r\n/g, "\n").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}
