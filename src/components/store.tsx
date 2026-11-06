"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MatchRule, Period, ProjectMapping, Settings, TimeEntry } from "@/lib/types";
import { clearDraft, defaultPeriod, defaultSettings, loadDraft, loadProjects, loadRules, loadSettings, saveDraft, saveProjects, saveRules, saveSettings } from "@/lib/storage";

interface Store {
  ready: boolean;
  storageOk: boolean;
  projects: ProjectMapping[];
  setProjects: (p: ProjectMapping[] | ((prev: ProjectMapping[]) => ProjectMapping[])) => void;
  settings: Settings;
  setSettings: (s: Settings | ((prev: Settings) => Settings)) => void;
  rules: MatchRule[];
  setRules: (r: MatchRule[] | ((prev: MatchRule[]) => MatchRule[])) => void;
  entries: TimeEntry[];
  setEntries: (e: TimeEntry[] | ((prev: TimeEntry[]) => TimeEntry[])) => void;
  period: Period;
  setPeriod: (p: Period) => void;
  resetDraft: () => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [storageOk, setStorageOk] = useState(true);
  const [projects, setProjects] = useState<ProjectMapping[]>([]);
  const [settings, setSettings] = useState<Settings>(() => defaultSettings());
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [rules, setRules] = useState<MatchRule[]>([]);
  const [period, setPeriod] = useState<Period>(() => defaultPeriod(defaultSettings().timeZone));

  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    setProjects(loadProjects());
    setRules(loadRules());
    const d = loadDraft();
    if (d) {
      setEntries(d.entries ?? []);
      if (d.period) setPeriod(d.period);
    } else setPeriod(defaultPeriod(s.timeZone));
    try {
      window.localStorage.setItem("tsc.v1.probe", "1");
      window.localStorage.removeItem("tsc.v1.probe");
    } catch {
      setStorageOk(false);
    }
    setReady(true);
  }, []);

  // Persist only after hydration; `ready` is state, so the first commit (before loaded values
  // are applied) never overwrites what is stored.
  useEffect(() => {
    if (ready) saveProjects(projects);
  }, [ready, projects]);
  useEffect(() => {
    if (ready) saveSettings(settings);
  }, [ready, settings]);
  useEffect(() => {
    if (ready) saveRules(rules);
  }, [ready, rules]);
  useEffect(() => {
    if (ready) saveDraft({ entries, period, savedAt: new Date().toISOString() });
  }, [ready, entries, period]);

  const resetDraft = useCallback(() => {
    clearDraft();
    setEntries([]);
    setPeriod(defaultPeriod(settings.timeZone));
  }, [settings.timeZone]);

  const value = useMemo<Store>(
    () => ({ ready, storageOk, projects, setProjects, settings, setSettings, rules, setRules, entries, setEntries, period, setPeriod, resetDraft }),
    [ready, storageOk, projects, settings, rules, entries, period, resetDraft],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}
