// Copies the pdf.js worker (+ standard fonts) into public/pdfjs and the Tesseract.js worker,
// WebAssembly cores and English language data into public/tesseract, so PDF reading and OCR run
// entirely from this site's own static files (no CDN).
// Runs automatically before `next build`; safe to run repeatedly.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "public");
const fontsDir = "node_modules/pdfjs-dist/standard_fonts";
const files = [
  ["node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", "pdfjs/pdf.worker.min.mjs"],
  ...(existsSync(join(root, fontsDir)) ? readdirSync(join(root, fontsDir)).map((f) => [`${fontsDir}/${f}`, `pdfjs/standard_fonts/${f}`]) : []),
  ["node_modules/tesseract.js/dist/worker.min.js", "tesseract/worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract/core/tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract/core/tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "tesseract/lang/eng.traineddata.gz"],
];
let copied = 0;
for (const [from, to] of files) {
  const src = join(root, from);
  const dest = join(out, to);
  if (!existsSync(src)) {
    if (existsSync(dest)) continue; // already bundled in the upload
    console.warn(`[assets] missing ${from}; OCR will not work until it is available`);
    continue;
  }
  mkdirSync(join(dest, ".."), { recursive: true });
  if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue;
  copyFileSync(src, dest);
  copied++;
}
console.log(`[assets] ${copied} file(s) copied to public/pdfjs and public/tesseract`);
