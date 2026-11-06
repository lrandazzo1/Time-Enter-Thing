import { describe, expect, it } from "vitest";
import { findOverlaps, mergeEntries, splitOverlapEvenly, validate, findDuplicates } from "@/lib/review";
import type { TimeEntry } from "@/lib/types";
import { period, projects, settings } from "./helpers";

const entry = (id: string, start: string, end: string, minutes: number, extra: Partial<TimeEntry> = {}): TimeEntry => ({
  id, source: "ics", title: id, date: "2026-11-05", intervals: [{ start, end }], minutes, projectId: "acme", task: "Planning",
  description: `Work ${id}`, location: "Main Office", included: true, status: "busy", notes: [], ...extra,
});

describe("overlaps", () => {
  const es = [entry("tfg", "12:00", "13:00", 60), entry("qb", "12:30", "13:30", 60), entry("mw", "13:00", "14:00", 60), entry("k", "14:00", "14:30", 30)];
  it("finds clusters and measures clock time", () => {
    const c = findOverlaps(es);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ unionMinutes: 120, claimedMinutes: 180, unresolved: true });
  });
  it("splits overlap evenly", () => {
    const split = splitOverlapEvenly(es, findOverlaps(es)[0]);
    expect(split).toEqual({ tfg: 45, qb: 30, mw: 45 });
    const fixed = es.map((e) => ({ ...e, minutes: split[e.id] ?? e.minutes }));
    expect(findOverlaps(fixed)[0].unresolved).toBe(false);
  });
  it("blocks export until resolved or confirmed", () => {
    expect(validate(es, { projects, settings, period }).some((i) => i.code === "overlap" && i.level === "error")).toBe(true);
    const acked = es.map((e) => ({ ...e, overlapAck: true }));
    expect(validate(acked, { projects, settings, period }).some((i) => i.code === "overlap")).toBe(false);
  });
});

describe("validation", () => {
  it("requires project, task, location, positive hours", () => {
    const issues = validate([entry("a", "09:00", "10:00", 0, { projectId: null, location: "" })], { projects, settings, period });
    const codes = issues.filter((i) => i.level === "error").map((i) => i.code).sort();
    expect(codes).toEqual(["hours", "location", "project"]);
  });
  it("rejects tasks not configured for the project", () => {
    const issues = validate([entry("a", "09:00", "10:00", 60, { task: "Springs" })], { projects, settings, period });
    expect(issues.some((i) => i.code === "task")).toBe(true);
  });
  it("detects duplicates by fingerprint", () => {
    const d = [entry("a", "09:00", "10:00", 60, { fingerprint: "x" }), entry("b", "11:00", "12:00", 60, { fingerprint: "x" })];
    expect(findDuplicates(d)).toEqual([["a", "b"]]);
  });
});

describe("merge", () => {
  it("combines same date/project/task", () => {
    const r = mergeEntries([entry("a", "09:00", "11:00", 120), entry("b", "13:00", "14:30", 90), entry("c", "15:00", "16:00", 60, { task: "Support" })]);
    expect(r.merged).toBe(1);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]).toMatchObject({ minutes: 210, description: "Work a; Work b" });
  });
});
