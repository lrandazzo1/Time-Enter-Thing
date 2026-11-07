import type { ProjectMapping } from "./types";

export const UNKNOWN_PROJECT = "Unknown project";

/**
 * Full Projector project name for a saved project, looked up from the imported project mappings.
 * Uses the project's own `fullName`, otherwise the full name of another saved mapping with the same
 * project code. Never falls back to the code or the client name: returns null when unknown.
 */
export function resolveProjectName(project: ProjectMapping | undefined, all: ProjectMapping[]): string | null {
  if (!project) return null;
  const own = project.fullName?.trim();
  if (own) return own;
  const code = project.code.trim().toUpperCase();
  if (!code) return null;
  const same = all.find((p) => p.id !== project.id && p.code.trim().toUpperCase() === code && p.fullName?.trim());
  return same?.fullName?.trim() ?? null;
}
