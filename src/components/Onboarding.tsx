"use client";
import { useState } from "react";
import { useStore } from "./store";
import { ProjectImporter } from "./ProjectImporter";
import { GenerateTimesheet } from "./GenerateTimesheet";
import { Button, Card, Notice } from "./ui";

const STEPS = ["Import projects", "Confirm projects & tasks", "Set default location", "Import calendar", "Review & export"];

/** First-run wizard. Shown only while settings.onboarding === "active". Progress is saved automatically. */
export function SetupComplete({ onContinue, onGuide }: { onContinue: () => void; onGuide: () => void }) {
  return (
    <div className="stack">
      <Card className="success-card">
        <div className="success-mark" aria-hidden>✓</div>
        <h1>Setup complete</h1>
        <p className="muted">Your projects, location and matches are saved in this browser. From now on each week is: import calendar → review hours → download CSV.</p>
        <div className="row wrap gap-sm mt center">
          <Button variant="primary" onClick={onContinue}>Go to my timesheet</Button>
          <Button onClick={onGuide}>How to import the CSV into BigTime</Button>
        </div>
      </Card>
    </div>
  );
}

export function Onboarding({ onGuide, onComplete }: { onGuide: () => void; onComplete: () => void }) {
  const { settings, setSettings, projects } = useStore();
  const step = Math.min(5, Math.max(1, settings.onboardingStep || 1));
  const [reviewing, setReviewing] = useState(false);
  const setStep = (n: number) => {
    setSettings((prev) => ({ ...prev, onboardingStep: n }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const shown = step === 1 && reviewing ? 2 : step;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Welcome to Timesheet Converter</h1>
          <p className="muted">A one-time setup (about five minutes). Everything stays on this device; no account needed.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setSettings((prev) => ({ ...prev, onboarding: "skipped" }))}>Skip setup</Button>
      </div>
      <ol className="wizard" aria-label="Setup progress">
        {STEPS.map((label, i) => (
          <li key={label} className={`wizard-step ${i + 1 === shown ? "is-current" : ""} ${i + 1 < shown ? "is-done" : ""}`} aria-current={i + 1 === shown ? "step" : undefined}>
            <span className="step-num">{i + 1 < shown ? "✓" : i + 1}</span>
            <span className="wizard-label">{label}</span>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <>
          {!reviewing && (
            <Notice tone="info" title="Step 1 — bring in your Projector projects">
              Easiest: download a <strong>Time Card Report</strong> from Projector as Excel (filtered to you, covering the last few months) and drop the original .xlsx below. Projects, codes, tasks and your work location are read automatically. You can add more projects any time.
            </Notice>
          )}
          <ProjectImporter onReviewing={setReviewing} onSaved={() => setStep(3)} />
          {!reviewing && (
            <div className="row wrap gap-sm">
              {projects.length > 0 && <Button variant="primary" onClick={() => setStep(3)}>Continue with {projects.length} saved project{projects.length === 1 ? "" : "s"} →</Button>}
              <Button variant="ghost" onClick={() => setStep(3)}>Skip — I&apos;ll add projects while matching my calendar</Button>
            </div>
          )}
        </>
      )}

      {step === 3 && (
        <Card title="Step 3 — your BigTime location" subtitle="Used on every time entry. Type it exactly as it appears in BigTime's Location list.">
          <label className="field narrow">
            <span>Default location</span>
            <input autoFocus value={settings.defaultLocation} placeholder="e.g. Main Office" onChange={(e) => setSettings((prev) => ({ ...prev, defaultLocation: e.target.value }))} />
          </label>
          <p className="small muted mt">Not sure? Open BigTime&apos;s Import Time → Review time screen and look at the Location dropdown. You can change this later on the Projects page.</p>
          <div className="row wrap gap-sm mt">
            <Button onClick={() => setStep(1)}>← Back</Button>
            <Button variant="primary" disabled={settings.locationRequired && !settings.defaultLocation.trim()} onClick={() => setStep(4)}>Continue →</Button>
            {!settings.defaultLocation.trim() && <Button variant="ghost" onClick={() => setSettings((prev) => ({ ...prev, locationRequired: false, onboardingStep: 4 }))}>My BigTime doesn&apos;t use Location</Button>}
          </div>
        </Card>
      )}

      {step >= 4 && (
        <GenerateTimesheet
          embedded
          onGuide={onGuide}
          onStep={(s) => {
            const want = s <= 1 ? 4 : 5;
            if (want !== step) setSettings((prev) => ({ ...prev, onboardingStep: want }));
          }}
          onExported={onComplete}
        />
      )}
      {step >= 4 && (
        <div className="row">
          <Button variant="ghost" size="sm" onClick={onComplete}>Finish setup without exporting</Button>
        </div>
      )}
    </div>
  );
}
