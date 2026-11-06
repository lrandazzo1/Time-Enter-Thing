/** RFC 4180 CSV writer with spreadsheet formula-injection protection. */

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Neutralise text that a spreadsheet would execute as a formula (=, +, -, @, tab, CR) by
 * prefixing an apostrophe (OWASP CSV-injection guidance). Applied only to free-text fields.
 */
export function guardFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

export function escapeCsvField(value: string): string {
  const v = value.replace(/\r\n?/g, "\n");
  return /[",\n\r]|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(escapeCsvField).join(",")).join("\r\n") + "\r\n";
}

export type CsvEncoding = "utf-8" | "utf-8-bom" | "windows-1252";

// Unicode code points for Windows-1252 bytes 0x80–0x9F (undefined slots are -1).
const CP1252_HIGH = [
  0x20ac, -1, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, -1, 0x017d, -1,
  -1, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, -1, 0x017e, 0x0178,
];
const CP1252_REVERSE = new Map<number, number>(CP1252_HIGH.map((cp, i) => [cp, 0x80 + i]).filter(([cp]) => cp > 0) as [number, number][]);

export interface EncodedCsv {
  bytes: Uint8Array;
  /** Characters that could not be represented and were replaced with "?". */
  unmappable: string[];
}

export function encodeCsv(text: string, encoding: CsvEncoding): EncodedCsv {
  if (encoding !== "windows-1252") {
    const body = new TextEncoder().encode(text);
    if (encoding === "utf-8") return { bytes: body, unmappable: [] };
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(body, 3);
    return { bytes: out, unmappable: [] };
  }
  const bytes: number[] = [];
  const bad = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) bytes.push(cp);
    else if (CP1252_REVERSE.has(cp)) bytes.push(CP1252_REVERSE.get(cp)!);
    else {
      bytes.push(0x3f);
      bad.add(ch);
    }
  }
  return { bytes: Uint8Array.from(bytes), unmappable: [...bad] };
}
