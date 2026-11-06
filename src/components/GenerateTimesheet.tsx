"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { ImportStep } from "./ImportStep";
import { ReviewStep } from "./ReviewStep";
import { ExportStep } from "./ExportStep";
import { Button } from "./ui";
import { validate } from "@/lib/review";

const STEPS = ["Import calendar", "Review hours", "Download CSV"] as const;

export function GenerateTimesheet({ onGuide }: { onGuide: () => void }) {
  const { ready, entries, resetDraft, projects, settings, period } = useStore();
  const [step, setStep] = useState(entries.length ? 1 : 0);
  const resumed = useRef(false);
  useEffect(() => {
    if (ready && !resumed.current) {
      resumed.current = true;
      if (entries.length) setStep(1);
    }
  }, [ready, entries.length]);
  const errors = validate(entries, { projects, settings, period }).filter((i) => i.level === "error").length;
  const go = (s: number) => {
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Generate timesheet</h1>
          <p className="muted">Import your Outlook calendar, confirm the hours you actually worked, and download a BigTime import file.</p>
        </div>
        {entries.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => {
            if (window.confirm("Start over? This clears the entries in the current timesheet (your projects and settings are kept).")) {
              resetDraft();
              go(0);
            }
          }}>Start over</Button>
        )}
      </div>

      <ol className="stepper" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className={`step ${i === step ? "is-current" : ""} ${i < step ? "is-done" : ""}`}>
            <button onClick={() => go(i)} aria-current={i === step ? "step" : undefined}>
              <span className="step-num">{i < step ? "✓" : i + 1}</span>
              <span className="step-label">{label}</span>
              {i === 1 && entries.length > 0 && <span className="step-meta">{entries.filter((e) => e.included).length} entries</span>}
              {i === 2 && entries.length > 0 && <span className={`step-meta ${errors ? "text-error" : ""}`}>{errors ? `${errors} to fix` : "ready"}</span>}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && <ImportStep onDone={() => go(1)} />}
      {step === 1 && <ReviewStep onBack={() => go(0)} onNext={() => go(2)} />}
      {step === 2 && <ExportStep onBack={() => go(1)} onGuide={onGuide} />}
    </div>
  );
}
