/** Lightweight fuzzy matching for client names (suggestions only — never auto-assigned). */

export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const STOP = new Set(["the", "and", "of", "inc", "llc", "ltd", "co", "corp", "corporation", "company", "group", "services", "service", "holdings", "international", "meeting", "sync", "call", "working", "session", "review", "weekly", "daily", "internal", "status", "update", "with", "for", "re", "fw"]);

export function significantTokens(s: string): string[] {
  return norm(s).split(" ").filter((t) => t.length >= 3 && !STOP.has(t));
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice similarity on character bigrams, 0–1. */
export function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  const total = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  return (2 * inter) / total;
}

/** Initials of the significant words: "The Northwind Group" → "tng" and "ng". */
export function acronyms(name: string): string[] {
  const words = norm(name).split(" ").filter(Boolean);
  const all = words.map((w) => w[0]).join("");
  const sig = words.filter((w) => !["the", "and", "of"].includes(w)).map((w) => w[0]).join("");
  return [...new Set([all, sig])].filter((a) => a.length >= 2);
}

export interface FuzzyHit<T> {
  item: T;
  score: number;
  reason: string;
}

/**
 * Score how well free text (a calendar title) refers to a client name.
 * Returns the best hit when it is clearly better than the runner-up.
 */
export function bestFuzzy<T>(text: string, items: T[], nameOf: (t: T) => string[]): FuzzyHit<T> | null {
  const tokens = significantTokens(text);
  const rawTokens = norm(text).split(" ");
  if (!tokens.length && !rawTokens.length) return null;
  const hits: FuzzyHit<T>[] = [];
  for (const item of items) {
    let best = 0;
    let reason = "";
    for (const name of nameOf(item)) {
      const ntoks = significantTokens(name);
      for (const ac of acronyms(name)) {
        if (ac.length >= 3 && rawTokens.includes(ac)) {
          best = Math.max(best, 0.86);
          reason = `“${ac.toUpperCase()}” looks like the initials of ${name}`;
        }
      }
      for (const nt of ntoks) {
        for (const t of tokens) {
          const d = dice(nt, t);
          if (d > best && d >= 0.72 && Math.min(nt.length, t.length) >= 4) {
            best = d;
            reason = `“${t}” is similar to ${name}`;
          }
        }
      }
    }
    if (best > 0) hits.push({ item, score: best, reason });
  }
  hits.sort((a, b) => b.score - a.score);
  if (!hits.length) return null;
  if (hits.length > 1 && hits[0].score - hits[1].score < 0.08) return null; // too close to call
  return hits[0];
}

/** Does an email domain stem ("northwindhomes" from northwindhomes.org) refer to this client? */
export function domainMatchesClient(domain: string, client: string): boolean {
  const stem = domain.toLowerCase().split(".").slice(0, -1).join("").replace(/[^a-z0-9]/g, "");
  if (stem.length < 4) return false;
  const compact = norm(client).replace(/\s+/g, "");
  const compactSig = significantTokens(client).join("");
  return [compact, compactSig].some((c) => c.length >= 4 && (stem.includes(c) || c.includes(stem) || (stem.length >= 6 && c.startsWith(stem.slice(0, 6)))));
}
