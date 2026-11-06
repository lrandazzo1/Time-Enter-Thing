// Copies the Tesseract.js worker, WebAssembly cores and English language data into
// public/tesseract so OCR runs entirely from this site's own static files (no CDN).
// Runs automatically before `next build`; safe to run repeatedly.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "public", "tesseract");
const files = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "core/tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "core/tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "core/tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "lang/eng.traineddata.gz"],
];
let copied = 0;
for (const [from, to] of files) {
  const src = join(root, from);
  const dest = join(out, to);
  if (!existsSync(src)) {
    if (existsSync(dest)) continue; // already bundled in the upload
    console.warn(`[ocr-assets] missing ${from}; OCR will not work until it is available`);
    continue;
  }
  mkdirSync(join(dest, ".."), { recursive: true });
  if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue;
  copyFileSync(src, dest);
  copied++;
}
console.log(`[ocr-assets] ${copied} file(s) copied to public/tesseract`);
