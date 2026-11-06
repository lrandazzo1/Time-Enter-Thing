"use client";
import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "./store";
import { GenerateTimesheet } from "./GenerateTimesheet";
import { ProjectsPage } from "./ProjectsPage";
import { SetupGuide } from "./SetupGuide";
import { Onboarding, SetupComplete } from "./Onboarding";
import { Notice } from "./ui";

type Tab = "home" | "projects" | "help";
const TABS: [Tab, string][] = [
  ["home", "Timesheet"],
  ["projects", "Projects"],
  ["help", "Help"],
];
const LEGACY: Record<string, Tab> = { generate: "home", guide: "help" };

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const { ready, storageOk, projects, settings, setSettings } = useStore();
  const [tab, setTab] = useState<Tab>("home");
  const [justCompleted, setJustCompleted] = useState(false);
  useEffect(() => {
    const fromHash = () => {
      const raw = window.location.hash.replace("#", "");
      const h = (LEGACY[raw] ?? raw) as Tab;
      if (TABS.some(([t]) => t === h)) setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    if (window.location.hash !== `#${t}`) history.replaceState(null, "", `#${t}`);
    window.scrollTo({ top: 0 });
  };
  const onboarding = ready && settings.onboarding === "active";
  const verified = projects.filter((p) => p.code && p.tasks.length).length;

  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#home" onClick={(e) => { e.preventDefault(); go("home"); }}>
            <span className="brand-mark" aria-hidden>
              <svg viewBox="0 0 32 32" width="26" height="26"><rect width="32" height="32" rx="8" fill="currentColor" /><path d="M9 11h14M9 16h14M9 21h8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /><circle cx="22.5" cy="21.5" r="3.5" fill="#fff" /></svg>
            </span>
            <span className="brand-name">Timesheet Converter</span>
          </a>
          <nav className="tabs" aria-label="Main">
            {TABS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className={`tab ${tab === id ? "is-active" : ""}`} aria-current={tab === id ? "page" : undefined} onClick={(e) => { e.preventDefault(); go(id); }}>
                {label}
                {id === "projects" && ready && <span className={`count ${verified ? "" : "count-empty"}`} aria-label={`${verified} projects ready`}>{verified}</span>}
              </a>
            ))}
          </nav>
          <span className="privacy-pill" title="Calendar files, screenshots and projects are processed in this browser and never uploaded.">🔒 Runs on your device</span>
        </div>
      </header>
      <main className="container" id="main" tabIndex={-1}>
        {!storageOk && (
          <Notice tone="warning" title="Browser storage is blocked">
            Your projects and draft can&apos;t be saved between visits (private window or strict privacy settings). Everything still works for this session — download a backup from the Projects page before closing.
          </Notice>
        )}
        {!ready ? (
          <p className="muted">Loading…</p>
        ) : tab === "home" ? (
          justCompleted ? (
            <SetupComplete onGuide={() => { setJustCompleted(false); go("help"); }} onContinue={() => { setJustCompleted(false); go("home"); }} />
          ) : onboarding ? (
            <Onboarding onGuide={() => go("help")} onComplete={() => { setSettings((prev) => ({ ...prev, onboarding: "done", onboardingStep: 5 })); setJustCompleted(true); window.scrollTo({ top: 0 }); }} />
          ) : (
            <GenerateTimesheet onGuide={() => go("help")} />
          )
        ) : tab === "projects" ? (
          <ProjectsPage onRestartSetup={() => { setSettings((prev) => ({ ...prev, onboarding: "active", onboardingStep: 1 })); go("home"); }} />
        ) : (
          <SetupGuide onStart={() => go("home")} onProjects={() => go("projects")} />
        )}
      </main>
      <footer className="footer">
        <div className="container footer-inner">
          <span>Free and private: calendar files, screenshots and projects are processed in this browser and never uploaded. Nothing is submitted to BigTime — you import the CSV yourself.</span>
          <span>Check that your company allows using this tool with client information. Browser storage is specific to this device and browser and can be cleared — keep a backup.</span>
        </div>
      </footer>
    </>
  );
}
