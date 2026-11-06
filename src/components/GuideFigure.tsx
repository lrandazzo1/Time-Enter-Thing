"use client";
import { useEffect, useRef, useState } from "react";

export interface Highlight {
  /** Percentages of the image box. */
  left: number;
  top: number;
  width: number;
  height: number;
  label?: string;
  tone?: "good" | "bad";
}

export function GuideFigure({ src, alt, caption, width, height, highlights = [] }: { src: string; alt: string; caption: React.ReactNode; width: number; height: number; highlights?: Highlight[] }) {
  const [open, setOpen] = useState(false);
  return (
    <figure className="guide-figure">
      <button className="figure-frame" style={{ maxWidth: Math.min(640, width) }} onClick={() => setOpen(true)} aria-label={`Enlarge: ${alt}`}>
        <Annotated src={src} alt={alt} width={width} height={height} highlights={highlights} />
        <span className="zoom-hint">🔍 Click to zoom</span>
      </button>
      <figcaption>{caption}</figcaption>
      {open && <Lightbox src={src} alt={alt} width={width} height={height} highlights={highlights} onClose={() => setOpen(false)} />}
    </figure>
  );
}

function Annotated({ src, alt, width, height, highlights, scale }: { src: string; alt: string; width: number; height: number; highlights: Highlight[]; scale?: number }) {
  return (
    <span className="annotated" style={scale ? { width: width * scale, height: height * scale } : { aspectRatio: `${width} / ${height}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} width={width} height={height} draggable={false} />
      {highlights.map((h, i) => (
        <span key={i} className={`hl hl-${h.tone ?? "good"}`} style={{ left: `${h.left}%`, top: `${h.top}%`, width: `${h.width}%`, height: `${h.height}%` }}>
          {h.label && <span className="hl-label">{h.label}</span>}
        </span>
      ))}
    </span>
  );
}

function Lightbox({ src, alt, width, height, highlights, onClose }: { src: string; alt: string; width: number; height: number; highlights: Highlight[]; onClose: () => void }) {
  const [scale, setScale] = useState(1.5);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") setScale((s) => Math.min(4, s + 0.25));
      if (e.key === "-") setScale((s) => Math.max(0.5, s - 0.25));
    };
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setScale((s) => Math.max(0.5, s - 0.25))} aria-label="Zoom out">−</button>
        <span>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(4, s + 0.25))} aria-label="Zoom in">+</button>
        <button onClick={() => setScale(1)}>Actual size</button>
        <button onClick={onClose} aria-label="Close">✕ Close</button>
      </div>
      <div className="lightbox-scroll" ref={ref} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <Annotated src={src} alt={alt} width={width} height={height} highlights={highlights} scale={scale} />
      </div>
    </div>
  );
}
