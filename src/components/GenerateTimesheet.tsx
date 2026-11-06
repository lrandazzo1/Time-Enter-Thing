"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { ImportStep } from "./ImportStep";
import { MatchStep } from "./MatchStep";
import { ReviewStep } from "./ReviewStep";
import { ExportStep } from "./ExportStep";
import { Button } from "./ui";
import { validate } from "@/lib/review";

const STEPS = ["Import calendar", "Match work", "Review hours", "Download CSV"] as const;

export function GenerateTimesheet({ onGuide, onStep, onExported, embedded = false }: { onGuide: () => void; onStep?: (step: number) => void; onExported?: () => void; embedded?: boolean }) {
  const { ready, entries, resetDraft, projects, settings, period } = useStore();
  const [step, setStep] = useState(0);
  const resumed = useRef(false);
  useEffect(() => {
    if (ready && !resumed.current) {
      resumed.current = true;
      if (entries.length) setStep(2);
    }
  }, [ready, entries.length]);
  useEffect(() => onStep?.(step), [step]); // eslint-disable-line react-hooks/exhaustive-deps
  const included = entries.filter((e) => e.included);
  const unmatched = included.filter((e) => !e.projectId || !e.task).length;
  const errors = validate(entries, { projects, settings, period }).filter((i) => i.level === "error").length + included.filter((e) => !e.confirmed).length;
  const go = (s: number) => {
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="stack">
      {!embedded && (
        <div className="page-head">
          <div>
            <h1>This week&apos;s timesheet</h1>
            <p className="muted">Import your Outlook calendar, confirm what you actually worked, download the BigTime file.</p>
          </div>
          {entries.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => {
              if (window.confirm("Start a new timesheet? This clears the current entries (projects, settings and remembered matches are kept).")) {
                resetDraft();
                go(0);
              }
            }}>Start a new week</Button>
          )}
        </div>
      )}

      <ol className="stepper four" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className={`step ${i === step ? "is-current" : ""} ${i < step ? "is-done" : ""}`}>
            <button onClick={() => go(i)} aria-current={i === step ? "step" : undefined}>
              <span className="step-num">{i < step ? "✓" : i + 1}</span>
              <span className="step-label">{label}</span>
              {i === 1 && entries.length > 0 && <span className={`step-meta ${unmatched ? "text-warning" : ""}`}>{unmatched ? `${unmatched} to match` : "all matched"}</span>}
              {i === 2 && entries.length > 0 && <span className="step-meta">{included.length} entries</span>}
              {i === 3 && entries.length > 0 && <span className={`step-meta ${errors ? "text-error" : ""}`}>{errors ? `${errors} open` : "ready"}</span>}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && <ImportStep onDone={() => go(1)} />}
      {step === 1 && <MatchStep onBack={() => go(0)} onNext={() => go(2)} />}
      {step === 2 && <ReviewStep onBack={() => go(1)} onNext={() => go(3)} />}
      {step === 3 && <ExportStep onBack={() => go(2)} onGuide={onGuide} onExported={onExported} />}
    </div>
  );
}
