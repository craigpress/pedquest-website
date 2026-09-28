/**
 * Build step: regenerate src/data/qbank-image-hashes.generated.ts — a content
 * hash for every question-bank PNG in public/images/qbank.
 *
 * A re-render keeps the filename (`<ID>.png`), so the pages append `?v=<hash>`
 * to the URL they hand the image optimizer. The hash changes whenever the PNG
 * bytes change, which gives each render its own long-lived cache entry and
 * means a stale optimized variant can never be served for a new render.
 *
 * Runs as part of `prebuild`, so a deploy's manifest always matches the PNGs
 * in that deploy.
 *
 *   npx tsx scripts/generate-image-hashes.ts          # write the file
 *   npx tsx scripts/generate-image-hashes.ts --check  # fail if it would change
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DIR = "public/images/qbank";
const OUT = "src/data/qbank-image-hashes.generated.ts";

const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".png")).sort() : [];
const entries = files.map((f) => {
  const hash = createHash("sha256").update(readFileSync(path.join(DIR, f))).digest("hex").slice(0, 10);
  return `  "/images/qbank/${f}": "${hash}",`;
});

const out = `// GENERATED FILE - DO NOT EDIT BY HAND.
//
// Produced by scripts/generate-image-hashes.ts during \`prebuild\`: a content
// hash per question-bank PNG, used as the \`?v=\` cache key on image URLs.
//
// ${files.length} images.

export const QBANK_IMAGE_HASHES: Record<string, string> = {
${entries.join("\n")}
};
`;

const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
if (process.argv.includes("--check")) {
  if (current !== out) {
    console.error(`${OUT} is out of date — run: npx tsx scripts/generate-image-hashes.ts`);
    process.exit(1);
  }
  console.log(`${OUT} is up to date (${files.length} images).`);
} else if (current !== out) {
  writeFileSync(OUT, out);
  console.log(`Wrote ${OUT} (${files.length} images).`);
} else {
  console.log(`${OUT} unchanged (${files.length} images).`);
}
