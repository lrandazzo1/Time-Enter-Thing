import { describe, expect, it } from "vitest";
import { findCodes, isValidCode } from "@/lib/projector/codes";
import { extractClient, normalizeTaskName, parseProjectorPages, parseProjectorText, parseTaskLine, projectStatus } from "@/lib/projector/parse";

const SAMPLE = `Select Project / Task
Search
Acme Components - Adaptive Planning - Implementation P001234-001
2 Planning
3 Gears
4 Bearings
5 Precision Parts
Globex - Adaptive Planning - MSP P005678-001
3 Planning Consultant LATE
The Metro Public Library (MPL) - Adaptive Planning - Implementation P007979-001
2 Planning
Our Firm - Internal P000999-001
5 Internal - Meeting
11 Internal - Training
`;

describe("project codes", () => {
  it("validates the Projector format and keeps leading zeros", () => {
    expect(isValidCode("P001234-001")).toBe(true);
    expect(isValidCode("P8252-001")).toBe(false);
    expect(findCodes("Acme - X P001234-001")[0]).toMatchObject({ raw: "P001234-001", status: "valid" });
  });
  it("flags OCR look-alikes instead of silently fixing them", () => {
    const [m] = findCodes("Acme - X PO01234-OO1");
    expect(m.status).toBe("ambiguous");
    expect(m.raw).toBe("PO01234-OO1");
    expect(m.suggestion).toBe("P001234-001");
    const [s] = findCodes("Acme - X P0O1234-0l1");
    expect(s.suggestion).toBe("P001234-011");
    const [d] = findCodes("Acme - X P001234–001"); // en dash
    expect(d.status).toBe("ambiguous");
    expect(findCodes("Phone 555-1234 Project 12")).toEqual([]);
  });
});

describe("client and task extraction", () => {
  it.each([
    ["Acme Components - Adaptive Planning - Implementation", "Acme Components"],
    ["Globex - Adaptive Planning - MSP", "Globex"],
    ["The Metro Public Library (MPL) - Adaptive Planning - Implementation", "The Metro Public Library (MPL)"],
    ["Smith-Jones Holdings - Adaptive Planning - Implementation", "Smith-Jones Holdings"],
    ["Smith - Jones LLC - Adaptive Planning - Implementation", "Smith - Jones LLC"],
    ["Northwind - Internal", "Northwind"],
  ])("%s → %s", (name, client) => expect(extractClient(name).client).toBe(client));

  it("flags clients it can't separate", () => {
    expect(extractClient("Globex Annual").uncertain).toBeTruthy();
  });
  it("removes only recognised numeric prefixes and badges", () => {
    expect(parseTaskLine("2 Planning")).toMatchObject({ name: "Planning", number: "2" });
    expect(parseTaskLine("11 Internal - Training")).toMatchObject({ name: "Internal - Training", number: "11" });
    expect(parseTaskLine("3 Planning Consultant LATE")?.name).toBe("Planning Consultant");
    expect(parseTaskLine("3. Gears")?.name).toBe("Gears");
    expect(parseTaskLine("2026 Budget")).toBeNull(); // a year is not a task number
    expect(parseTaskLine("Planning")).toBeNull();
    expect(normalizeTaskName("2 Planning")).toBe("Planning");
    expect(normalizeTaskName("2 Planning", true)).toBe("2 Planning");
    expect(normalizeTaskName("Phase 2 Planning")).toBe("Phase 2 Planning");
  });
});

describe("text parsing", () => {
  const r = parseProjectorText(SAMPLE);
  it("finds every project with its tasks", () => {
    expect(r.projects.map((p) => [p.client, p.code, p.tasks.map((t) => t.name)])).toEqual([
      ["Acme Components", "P001234-001", ["Planning", "Gears", "Bearings", "Precision Parts"]],
      ["Globex", "P005678-001", ["Planning Consultant"]],
      ["The Metro Public Library (MPL)", "P007979-001", ["Planning"]],
      ["Our Firm", "P000999-001", ["Internal - Meeting", "Internal - Training"]],
    ]);
    expect(r.projects[0].fullName).toBe("Acme Components - Adaptive Planning - Implementation");
    expect(r.projects[3].internal).toBe(true);
    expect(r.projects.every((p) => projectStatus(p) === "verified")).toBe(true);
    expect(r.looseLines).toEqual([]);
  });
  it("keeps numbers when configured", () => {
    expect(parseProjectorText(SAMPLE, { keepTaskNumbers: true }).projects[0].tasks[0].name).toBe("2 Planning");
  });
  it("handles messy copied text: tabs, extra spaces, bullets, multiple tasks per line", () => {
    const messy = "  • Acme Components - Adaptive Planning - Implementation\tP001234-001  \n\t2 Planning   3 Gears\n";
    const p = parseProjectorText(messy).projects[0];
    expect(p).toMatchObject({ client: "Acme Components", code: "P001234-001" });
    expect(p.tasks.map((t) => t.name)).toEqual(["Planning", "Gears"]);
  });
  it("flags a missing code and a project without tasks", () => {
    const r2 = parseProjectorText("Initech - Adaptive Planning - Implementation\n2 Planning\nUmbrella - Workday - Support P004444-001\n");
    expect(r2.projects[0]).toMatchObject({ client: "Initech", codeStatus: "missing" });
    expect(projectStatus(r2.projects[0])).toBe("review");
    expect(r2.projects[1].issues.some((i) => i.startsWith("No tasks"))).toBe(true);
  });
  it("joins a project name wrapped onto two lines", () => {
    const p = parseProjectorText("Acme Components - Adaptive Planning -\nImplementation P001234-001\n2 Planning").projects[0];
    expect(p.fullName).toBe("Acme Components - Adaptive Planning - Implementation");
  });
});

describe("multiple screenshots", () => {
  const page = (label: string, rows: [string, number][]) => ({ label, width: 1000, lines: rows.map(([text, x], i) => ({ text, x0: x, y0: i * 30, x1: x + 400, y1: i * 30 + 20, confidence: 92 })) });
  it("treats tasks at the top of a page as orphans with a continuation suggestion", () => {
    const r = parseProjectorPages([
      page("Screenshot 1", [["Acme Components - Adaptive Planning - Implementation P001234-001", 20], ["2 Planning", 60], ["3 Gears", 60]]),
      page("Screenshot 2", [["4 Bearings", 60], ["Globex - Adaptive Planning - MSP P005678-001", 20], ["3 Planning Consultant", 60]]),
    ]);
    expect(r.projects).toHaveLength(2);
    expect(r.projects[0].tasks.map((t) => t.name)).toEqual(["Planning", "Gears"]);
    expect(r.orphanTasks).toHaveLength(1);
    expect(r.orphanTasks[0].task.name).toBe("Bearings");
    expect(r.orphanTasks[0].likelyProjectKey).toBe(r.projects[0].key);
  });
  it("merges a project repeated across screenshots and unions tasks", () => {
    const r = parseProjectorPages([
      page("A", [["Acme Components - Adaptive Planning - Implementation P001234-001", 20], ["2 Planning", 60], ["3 Gears", 60]]),
      page("B", [["Acme Components - Adaptive Planning - Implementation P001234-001", 20], ["3 Gears", 60], ["4 Bearings", 60]]),
    ]);
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0].tasks.map((t) => t.name)).toEqual(["Planning", "Gears", "Bearings"]);
    expect(r.projects[0].pages).toEqual(["A", "B"]);
  });
  it("uses indentation: a task less indented than its project is marked uncertain", () => {
    const r = parseProjectorPages([page("A", [["Acme Components - Adaptive Planning - Implementation P001234-001", 120], ["2 Planning", 160], ["3 Gears", 20]])]);
    expect(r.projects[0].tasks[0].uncertain).toBeUndefined();
    expect(r.projects[0].tasks[1].uncertain).toMatch(/indented/);
  });
  it("flags an ambiguous duplicate of a valid code", () => {
    const r = parseProjectorText("Acme - Adaptive Planning - X P001234-001\n2 Planning\nAcme - Adaptive Planning - X PO01234-001\n2 Planning");
    expect(r.projects).toHaveLength(2);
    expect(r.projects[1].issues.some((i) => i.includes("Probably the same project"))).toBe(true);
  });
});
