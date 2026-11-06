"use client";
import { useCallback, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function Button({ variant = "secondary", size = "md", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  return <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} {...rest} />;
}

export function Card({ title, subtitle, actions, children, className = "" }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warning" | "error" | "success"; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {title && <strong className="notice-title">{title}</strong>}
      {children && <div className="notice-body">{children}</div>}
    </div>
  );
}

export function Badge({ tone = "neutral", children, title }: { tone?: "neutral" | "info" | "warning" | "error" | "success"; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Dropzone({ accept, multiple, onFiles, label, hint, icon }: { accept: string; multiple?: boolean; onFiles: (files: File[]) => void; label: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const take = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      onFiles(Array.from(list));
    },
    [onFiles],
  );
  return (
    <div
      className={`dropzone ${over ? "is-over" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files);
      }}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="dropzone-icon" aria-hidden>
        {icon ?? "⬆"}
      </div>
      <div className="dropzone-label">{label}</div>
      {hint && <div className="dropzone-hint">{hint}</div>}
    </div>
  );
}

export function downloadBytes(bytes: Uint8Array | string, fileName: string, mime: string) {
  const blob = new Blob([typeof bytes === "string" ? bytes : (bytes as BlobPart)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Read a text file; Outlook CSV exports are often Windows-1252, so fall back when it isn't valid UTF-8. */
export async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}
