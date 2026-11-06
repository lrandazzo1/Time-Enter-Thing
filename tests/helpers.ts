import type { ProjectMapping, Settings } from "@/lib/types";

export const projects: ProjectMapping[] = [
  { id: "acme", client: "Acme Corp", aliases: ["Acme"], code: "P000100-001", tasks: ["Planning", "Support"], defaultTask: "", billable: true },
  { id: "globex", client: "Globex", aliases: [], code: "P000200-001", tasks: ["Consultant"], defaultTask: "Consultant", billable: true },
  { id: "internal", client: "Our Firm", aliases: ["internal"], code: "P000999-001", tasks: ["Internal - Meeting", "Internal - Training"], defaultTask: "Internal - Meeting", billable: false },
];

export const settings: Settings = {
  timeZone: "America/Chicago",
  defaultLocation: "Main Office",
  locationRequired: true,
  exclusionKeywords: ["lunch", "PTO"],
  csvDateOrder: "MDY",
  keepTaskNumbers: false,
  onboarding: "done",
  onboardingStep: 5,
};

export const period = { start: "2026-11-02", end: "2026-11-08" };
