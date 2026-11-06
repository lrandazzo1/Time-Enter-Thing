/**
 * Projector / BigTime project-code detection.
 *
 * Standard format: "P" + 6 digits + "-" + 3 digits, e.g. P001234-001 (leading zeros are significant).
 * OCR often confuses O/0, I/l/|/1, S/5, B/8, Z/2 and dash characters. Those readings are reported as
 * *ambiguous* with a suggested correction — never silently rewritten.
 */

export const CODE_PATTERN = /^P\d{6}-\d{3}$/;
const STRICT = /(?<![A-Za-z0-9])P\d{6}-\d{3}(?![A-Za-z0-9])/g;
// Loose: P (or p) + 6 digit-like chars + optional separator + 3 digit-like chars.
const DIGITISH = "[0-9OoQDIl|!iSsBZzGgT]";
const LOOSE = new RegExp(`(?<![A-Za-z0-9])[Pp]\\s?(${DIGITISH}{6})\\s?([-\\u2010-\\u2015_~.=]|\\s)?\\s?(${DIGITISH}{3})(?![A-Za-z0-9])`, "g");

const DIGIT_MAP: Record<string, string> = { O: "0", o: "0", Q: "0", D: "0", I: "1", l: "1", "|": "1", "!": "1", i: "1", S: "5", s: "5", B: "8", Z: "2", z: "2", G: "6", g: "9", T: "7" };

export function isValidCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export interface CodeMatch {
  /** Text exactly as read. */
  raw: string;
  /** Index of the match in the source text. */
  index: number;
  status: "valid" | "ambiguous";
  /** For ambiguous readings: the code with look-alike characters replaced. Needs user confirmation. */
  suggestion?: string;
  /** Human-readable explanation of what looked wrong. */
  reason?: string;
}

/** Find project codes in a line of text. Valid codes come first; ambiguous readings are returned only where no valid code overlaps. */
export function findCodes(text: string): CodeMatch[] {
  const out: CodeMatch[] = [];
  for (const m of text.matchAll(STRICT)) out.push({ raw: m[0], index: m.index ?? 0, status: "valid" });
  for (const m of text.matchAll(LOOSE)) {
    const idx = m.index ?? 0;
    if (out.some((o) => idx < o.index + o.raw.length && o.index < idx + m[0].length)) continue;
    const head = m[1];
    const tail = m[3];
    const sep = m[2] ?? "";
    const fixed = `P${[...head].map((c) => DIGIT_MAP[c] ?? c).join("")}-${[...tail].map((c) => DIGIT_MAP[c] ?? c).join("")}`;
    if (!isValidCode(fixed)) continue;
    const problems: string[] = [];
    if (m[0][0] === "p") problems.push("lowercase p");
    const swapped = [...head, ...tail].filter((c) => DIGIT_MAP[c]);
    if (swapped.length) problems.push(`look-alike character${swapped.length > 1 ? "s" : ""} ${[...new Set(swapped)].map((c) => `“${c}”`).join(", ")}`);
    if (sep !== "-") problems.push(sep.trim() ? `separator “${sep}” instead of “-”` : "missing or spaced hyphen");
    if (/\s/.test(m[0])) problems.push("extra spaces");
    out.push({ raw: m[0], index: idx, status: "ambiguous", suggestion: fixed, reason: `Read as “${m[0]}” (${problems.join("; ")}). Check it against Projector.` });
  }
  return out.sort((a, b) => a.index - b.index);
}
