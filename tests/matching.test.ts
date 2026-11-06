import { describe, expect, it } from "vitest";
import { matchEvent, eventToEntry, stripTaskPrefix } from "@/lib/matching";
import type { CalendarEvent } from "@/lib/types";
import { projects, settings } from "./helpers";

const ev = (title: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  title, description: "", location: "", date: "2026-11-02", start: "09:00", end: "10:00", minutes: 60,
  allDay: false, canceled: false, status: "busy", recurring: false, source: "ics", ...extra,
});

describe("matching", () => {
  it("uses the CLIENT | TASK | DESCRIPTION convention", () => {
    expect(matchEvent("Acme Corp | Support | Client support", "", projects)).toMatchObject({ projectId: "acme", task: "Support", description: "Client support" });
    expect(matchEvent("acme | 2 Planning | x", "", projects)).toMatchObject({ projectId: "acme", task: "Planning" });
  });
  it("flags unknown tasks instead of guessing", () => {
    const m = matchEvent("Acme Corp | Springs | x", "", projects);
    expect(m.projectId).toBe("acme");
    expect(m.task).toBe("");
    expect(m.notes[0].code).toBe("convention-task-unmatched");
  });
  it("uses single/default tasks and keyword aliases", () => {
    expect(matchEvent("Weekly Globex status", "", projects)).toMatchObject({ projectId: "globex", task: "Consultant" });
    expect(matchEvent("Acme planning session", "", projects)).toMatchObject({ projectId: "acme", task: "Planning" });
    expect(matchEvent("Acme kickoff", "", projects).notes[0].code).toBe("task-unclear");
  });
  it("flags ambiguity across clients", () => {
    const m = matchEvent("INTERNAL: Acme sync", "", projects);
    expect(m.projectId).toBeNull();
    expect(m.candidates?.sort()).toEqual(["acme", "internal"]);
  });
  it("does not match partial words", () => {
    expect(matchEvent("Acmeville picnic", "", projects).projectId).toBeNull();
  });
  it("excludes cancelled, all-day, keyword and free events", () => {
    expect(eventToEntry(ev("Canceled: Acme", { canceled: true }), projects, settings).included).toBe(false);
    expect(eventToEntry(ev("Lunch with team"), projects, settings).excludeReason).toMatch(/lunch/);
    expect(eventToEntry(ev("Acme Corp | Planning | x", { status: "free" }), projects, settings).included).toBe(false);
    const t = eventToEntry(ev("Acme Corp | Planning | x", { status: "tentative" }), projects, settings);
    expect(t.included).toBe(true);
    expect(t.notes.some((n) => n.code === "tentative")).toBe(true);
    expect(t.location).toBe("Main Office");
  });
  it("validates AI suggestions against the configured list", () => {
    const e = eventToEntry(ev("Quarterly review", { source: "screenshot", ai: { projectCode: "P000200-001", task: "Consultant", confidence: "high", notes: "" } }), projects, settings);
    expect(e).toMatchObject({ projectId: "globex", task: "Consultant" });
    const bad = eventToEntry(ev("Quarterly review", { source: "screenshot", ai: { projectCode: "P123", task: "X", confidence: "high", notes: "" } }), projects, settings);
    expect(bad.projectId).toBeNull();
  });
  it("strips numeric prefixes", () => {
    expect(stripTaskPrefix("3 Planning Consultant")).toBe("Planning Consultant");
    expect(stripTaskPrefix("11 Internal - Training")).toBe("Internal - Training");
    expect(stripTaskPrefix("Planning")).toBe("Planning");
  });
});

describe("pipe titles that are not the convention", () => {
  it("uses the only task when the second segment is not a task", () => {
    const m = matchEvent("Globex | Vendor Working Session", "", projects);
    expect(m).toMatchObject({ projectId: "globex", task: "Consultant" });
    expect(m.notes[0].level).toBe("info");
  });
});
