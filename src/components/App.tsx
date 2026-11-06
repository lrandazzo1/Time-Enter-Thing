"use client";
import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "./store";
import { GenerateTimesheet } from "./GenerateTimesheet";
import { ProjectsPage } from "./ProjectsPage";
import { SetupGuide } from "./SetupGuide";
import { Notice } from "./ui";

type Tab = "generate" | "projects" | "guide";
const TABS: [Tab, string][] = [
  ["generate", "Generate Timesheet"],
  ["projects", "Projects & Tasks"],
  ["guide", "Setup Guide"],
];

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const { ready, storageOk, projects } = useStore();
  const [tab, setTab] = useState<Tab>("generate");
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace("#", "") as Tab;
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

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#generate" onClick={(e) => { e.preventDefault(); go("generate"); }}>
            <span className="brand-mark" aria-hidden>
              <svg viewBox="0 0 32 32" width="26" height="26"><rect width="32" height="32" rx="8" fill="currentColor" /><path d="M9 11h14M9 16h14M9 21h8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /><circle cx="22.5" cy="21.5" r="3.5" fill="#fff" /></svg>
            </span>
            <span className="brand-name">Timesheet Converter</span>
          </a>
          <nav className="tabs" aria-label="Main">
            {TABS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className={`tab ${tab === id ? "is-active" : ""}`} aria-current={tab === id ? "page" : undefined} onClick={(e) => { e.preventDefault(); go(id); }}>
                {label}
                {id === "projects" && ready && projects.length === 0 && <span className="dot" aria-label="needs setup" />}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main className="container">
        {!storageOk && (
          <Notice tone="warning" title="Browser storage is blocked">
            Your projects and draft can&apos;t be saved between visits (private window or strict privacy settings). Everything still works for this session — export your projects CSV before closing.
          </Notice>
        )}
        {!ready ? (
          <p className="muted">Loading…</p>
        ) : tab === "generate" ? (
          <GenerateTimesheet onGuide={() => go("guide")} />
        ) : tab === "projects" ? (
          <ProjectsPage />
        ) : (
          <SetupGuide onStart={() => go("generate")} onProjects={() => go("projects")} />
        )}
      </main>
      <footer className="footer">
        <div className="container footer-inner">
          <span>Data stays in your browser. Nothing is submitted to BigTime — you import the CSV yourself.</span>
        </div>
      </footer>
    </>
  );
}
