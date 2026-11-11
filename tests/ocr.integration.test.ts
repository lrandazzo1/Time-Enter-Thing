/**
 * Real OCR integration test: synthetic Projector screenshots → Tesseract.js (local model, no network)
 * → engine-independent OcrPage → Projector parser. Run with `npm test`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import { PNG } from "pngjs";
import { fromTesseract, type OcrPage } from "@/lib/ocr/types";
import { chooseScale, enhance } from "@/lib/ocr/enhance";
import { parseProjectorPages, projectStatus } from "@/lib/projector/parse";
import { parseAgenda } from "@/lib/pdf/agenda";
import { ocrToPdfPages } from "@/lib/pdf/extract";

const FIX = "tests/fixtures/projector";
let worker: Worker;

/** Same pipeline as the browser: decode → enhance (upscale/grayscale/contrast/invert) → OCR. */
async function ocr(file: string, dir = FIX): Promise<OcrPage> {
  const png = PNG.sync.read(readFileSync(path.join(dir, file)));
  const scale = chooseScale(png.width, png.height);
  const e = enhance({ data: png.data, width: png.width, height: png.height }, scale);
  const out = new PNG({ width: e.width, height: e.height });
  out.data = Buffer.from(e.data);
  const { data } = await worker.recognize(PNG.sync.write(out), {}, { blocks: true, text: true });
  return fromTesseract(file, data, png.width, png.height, scale);
}

beforeAll(async () => {
  worker = await createWorker("eng", OEM.LSTM_ONLY, {
    langPath: path.resolve("node_modules/@tesseract.js-data/eng/4.0.0_best_int"),
    gzip: true,
    cacheMethod: "none",
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1" });
}, 60_000);
afterAll(async () => worker?.terminate());

describe("OCR → Projector parser (real images)", () => {
  it("reads a full project list", async () => {
    const page = await ocr("projector-list-1.png");
    const r = parseProjectorPages([page]);
    const summary = r.projects.map((p) => ({ client: p.client, code: p.code, status: p.codeStatus, tasks: p.tasks.map((t) => t.name) }));
    console.log("projector-list-1 →", JSON.stringify(summary));
    expect(summary).toEqual([
      { client: "Acme Components", code: "P001234-001", status: "valid", tasks: ["Planning", "Gears", "Bearings", "Precision Parts"] },
      { client: "Globex Corporation", code: "P005678-001", status: "valid", tasks: ["Planning Consultant"] },
      { client: "Smith-Jones Holdings", code: "P002468-002", status: "valid", tasks: ["Consultant"] },
      { client: "Our Firm", code: "P000999-001", status: "valid", tasks: ["Internal - Meeting"] },
    ]);
    expect(r.projects.every((p) => projectStatus(p) === "verified")).toBe(true);
  }, 60_000);

  it("reads a dark-mode screenshot (after inversion the same data is found)", async () => {
    const r = parseProjectorPages([await ocr("projector-list-1-dark.png")]);
    console.log("dark →", JSON.stringify(r.projects.map((p) => [p.code, p.codeStatus, p.tasks.length])));
    expect(r.projects.map((p) => p.code)).toEqual(["P001234-001", "P005678-001", "P002468-002", "P000999-001"]);
  }, 60_000);

  it("combines a multi-screenshot batch: continuation, overlap and merging", async () => {
    const pages = [await ocr("projector-list-1.png"), await ocr("projector-list-2.png"), await ocr("projector-list-3.png")];
    const r = parseProjectorPages(pages);
    const summary = r.projects.map((p) => [p.client, p.code, p.tasks.map((t) => t.name).join("; ")]);
    console.log("batch →", JSON.stringify(summary), "orphans →", JSON.stringify(r.orphanTasks.map((o) => o.task.name)));
    expect(summary).toEqual([
      ["Acme Components", "P001234-001", "Planning; Gears; Bearings; Precision Parts"],
      ["Globex Corporation", "P005678-001", "Planning Consultant"],
      ["Smith-Jones Holdings", "P002468-002", "Consultant"],
      ["Our Firm", "P000999-001", "Internal - Meeting"],
      ["The Metro Public Library (MPL)", "P007979-001", "Planning"],
      ["Initech", "P003141-001", "Support; Integration; Training"],
      ["Umbrella Health", "P008080-003", "Planning"],
    ]);
    // "11 Internal - Training" sits above the first project on screenshot 2: offered, not assigned.
    expect(r.orphanTasks.map((o) => o.task.name)).toEqual(["Internal - Training"]);
    expect(r.orphanTasks[0].likelyProjectKey).toBe(r.projects[3].key);
  }, 120_000);
});

describe("OCR limits (real images)", () => {
  it("a small, blurry, compressed screenshot never yields a wrong 'valid' code", async () => {
    const r = parseProjectorPages([await ocr("projector-list-1-degraded.png")]);
    const truth = new Set(["P001234-001", "P005678-001", "P002468-002", "P000999-001"]);
    console.log("degraded →", JSON.stringify(r.projects.map((p) => [p.client, p.code, p.codeStatus, p.tasks.map((t) => t.name)])));
    for (const p of r.projects) {
      if (p.codeStatus === "valid") expect(truth.has(p.code)).toBe(true);
      else expect(projectStatus(p)).toBe("review");
    }
  }, 60_000);

});

describe("image-only calendar PDF → on-device text recognition → agenda parser", () => {
  it("reads the meetings, and flags every one for checking", async () => {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    const page = await ocr("agenda-image.png", "tests/fixtures/pdf");
    const r = parseAgenda(ocrToPdfPages([page]), { ocr: true });
    const got = r.events.map((e) => [e.date, e.start, e.end, e.minutes, e.title]);
    console.log("agenda OCR →", JSON.stringify(got), "confidence", r.diagnostics.ocr?.meanConfidence);
    expect(got).toEqual([
      ["2026-11-02", "09:00", "10:30", 90, "Acme Components | Gears | Forecast model"],
      ["2026-11-02", "13:00", "14:00", 60, "Globex Corporation weekly sync"],
      ["2026-11-03", "15:00", "16:00", 60, "Smith-Jones Holdings review"],
    ]);
    expect(r.events.every((e) => e.parseNotes?.some((n) => n.code === "pdf-check"))).toBe(true);
  }, 60_000);
});

