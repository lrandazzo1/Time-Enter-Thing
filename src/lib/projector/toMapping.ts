import type { ProjectMapping } from "../types";
import { isValidCode } from "./codes";
import type { ParsedProject } from "./parse";
import { uid } from "../uid";

/** Editable row in the project verification table. */
export interface ReviewProject extends ParsedProject {
  approved: boolean;
}

export function rowProblems(p: ReviewProject): string[] {
  const out: string[] = [];
  if (!p.client.trim()) out.push("Client name is required.");
  if (!p.code.trim()) out.push("Project code is required.");
  else if (!isValidCode(p.code.trim())) out.push(p.codeStatus === "ambiguous" ? `Check the code “${p.code}”.` : `“${p.code}” isn't in the P000000-000 format — check it (you can still save it if Projector really uses it).`);
  if (p.tasks.length === 0) out.push("No tasks — add at least one before logging time.");
  if (p.tasks.some((t) => t.uncertain)) out.push("A task needs checking.");
  return out;
}

export function rowStatus(p: ReviewProject): "verified" | "review" {
  return p.codeStatus === "valid" && isValidCode(p.code.trim()) && p.client.trim() && p.tasks.length > 0 && !p.tasks.some((t) => t.uncertain) && !p.clientUncertain ? "verified" : "review";
}

export function toMapping(p: ReviewProject, source: ProjectMapping["source"]): ProjectMapping {
  const tasks = [...new Set(p.tasks.map((t) => t.name.trim()).filter(Boolean))];
  return {
    id: uid(),
    client: p.client.trim(),
    aliases: [],
    code: p.code.trim(),
    tasks,
    defaultTask: tasks.length === 1 ? tasks[0] : "",
    billable: !p.internal,
    fullName: p.fullName.trim() || undefined,
    source,
    location: p.location?.trim() || undefined,
    roles: p.roles?.length ? [...p.roles] : undefined,
  };
}
