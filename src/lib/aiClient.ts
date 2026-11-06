"use client";
import type { BusyStatus, CalendarEvent, ProjectMapping } from "./types";
import { intervalMinutes, isValidHHMM, isValidISODate } from "./time";
import { loadAccessCode } from "./storage";

export interface AiStatus {
  ai: boolean;
  model: string | null;
  accessCodeRequired: boolean;
}

export async function fetchAiStatus(): Promise<AiStatus> {
  try {
    const r = await fetch("/api/status", { cache: "no-store" });
    if (!r.ok) return { ai: false, model: null, accessCodeRequired: false };
    return (await r.json()) as AiStatus;
  } catch {
    return { ai: false, model: null, accessCodeRequired: false };
  }
}

const TARGET_BYTES = 3.4 * 1024 * 1024;

/** Read an image file as base64, downscaling/re-encoding only if needed to fit the upload limit. */
export async function imageToPayload(file: File): Promise<{ mediaType: string; data: string }> {
  const okType = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type);
  if (okType && file.size <= TARGET_BYTES) return { mediaType: file.type, data: await fileToBase64(file) };
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
  for (let attempt = 0; attempt < 5; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not encode image"))), "image/jpeg", 0.9));
    if (blob.size <= TARGET_BYTES) return { mediaType: "image/jpeg", data: await fileToBase64(blob) };
    scale *= 0.8;
  }
  throw new Error("Image is too large even after resizing. Crop the screenshot and try again.");
}

function fileToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]+,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const code = loadAccessCode();
  if (code) headers["x-access-code"] = code;
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const json = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(json.error || `Request failed (${r.status}).`);
  return json as T;
}

interface RawEvent {
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  status: string;
  visible_details: string;
  suggested_project_code: string;
  suggested_task: string;
  confidence: "high" | "medium" | "low";
  notes: string;
}

export interface ScreenshotResult {
  events: CalendarEvent[];
  warnings: string[];
}

export async function extractEventsFromScreenshot(file: File, opts: { referenceDate: string; timeZone: string; projects: ProjectMapping[]; label: string }): Promise<ScreenshotResult> {
  const image = await imageToPayload(file);
  const res = await postJson<{ events: RawEvent[]; warnings: string[] }>("/api/extract-events", {
    image,
    consent: true,
    referenceDate: opts.referenceDate,
    timeZone: opts.timeZone,
    projects: opts.projects.map((p) => ({ client: p.client, aliases: p.aliases, code: p.code, tasks: p.tasks })),
  });
  const warnings = [...(res.warnings ?? [])];
  const events: CalendarEvent[] = [];
  for (const r of res.events ?? []) {
    const title = String(r.title ?? "").trim();
    const date = isValidISODate(r.date) ? r.date : "";
    let start = isValidHHMM(r.start_time) ? r.start_time : null;
    let end = isValidHHMM(r.end_time) ? r.end_time : null;
    if (start && end && intervalMinutes(start, end) <= 0) {
      warnings.push(`"${title}": end time is not after start time — times cleared.`);
      start = end = null;
    }
    const statusMap: Record<string, BusyStatus> = { busy: "busy", tentative: "tentative", free: "free", canceled: "free", out_of_office: "oof" };
    events.push({
      title: title || "Untitled event",
      description: String(r.visible_details ?? ""),
      location: "",
      date,
      start,
      end,
      minutes: start && end ? intervalMinutes(start, end) : null,
      allDay: Boolean(r.all_day),
      canceled: r.status === "canceled",
      status: statusMap[r.status] ?? "unknown",
      recurring: false,
      source: "screenshot",
      sourceLabel: opts.label,
      ai: { projectCode: r.suggested_project_code ?? "", task: r.suggested_task ?? "", confidence: r.confidence ?? "low", notes: r.notes ?? "" },
    });
  }
  return { events, warnings };
}

export interface ExtractedProject {
  client: string;
  project_code: string;
  project_name: string;
  tasks: string[];
  looks_internal: boolean;
  notes: string;
}

export async function extractProjectsFromScreenshot(file: File): Promise<{ projects: ExtractedProject[]; warnings: string[] }> {
  const image = await imageToPayload(file);
  return postJson("/api/extract-projects", { image, consent: true });
}
