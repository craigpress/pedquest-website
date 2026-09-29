// Publish the EEG feature gallery: upload the rendered catalog to the private storage bucket and write the
// manifest the site reads (src/data/eeg-gallery.json).
//
//   npx tsx scripts/eeg-gallery-publish.mts <catalog dir> [--apply]
//
// <catalog dir> is research/eeg-atlas/gallery-<date>/ (manifest.json + renders/<id>.png and <id>.w800.webp, made by
// its render_catalog.py). Objects go to eeg-gallery/<renderer version>/<id>.png|.w800.webp, so a new renderer
// version never overwrites the images editors reviewed. Items that did not render are left out of the manifest.
// Without --apply it only reports what it would do.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./_env";

type CatalogItem = {
  id: string; title: string; category: string; subcategory: string; caption: string;
  tags: Record<string, unknown>; kind: string; rendered: boolean; renderer_version?: string; spec_hash?: string;
  width?: number; height?: number;
};

const BUCKET = "eeg-gallery";

async function main() {
  loadEnvLocal();
  const dir = resolve(process.argv[2] ?? "");
  const apply = process.argv.includes("--apply");
  const man = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
    renderer_version: string; items: CatalogItem[];
  };
  const items = man.items.filter((i) => i.rendered && existsSync(join(dir, "renders", `${i.id}.w800.webp`)));
  const skipped = man.items.filter((i) => !items.includes(i)).map((i) => i.id);
  console.log(`catalog ${man.items.length} items, ${items.length} rendered, renderer ${man.renderer_version}`);
  if (skipped.length) console.log(`  not rendered (left out): ${skipped.join(", ")}`);

  const out = {
    rendererVersion: man.renderer_version,
    generated: new Date().toISOString(),
    items: items.map((i) => {
      const rv = i.renderer_version ?? man.renderer_version;
      return {
        id: i.id, title: i.title, category: i.category, subcategory: i.subcategory, caption: i.caption,
        tags: i.tags ?? {}, kind: i.kind, rendererVersion: rv, specHash: i.spec_hash ?? "",
        width: i.width ?? 1600, height: i.height ?? 900,
        path: `${rv}/${i.id}.png`, thumbPath: `${rv}/${i.id}.w800.webp`,
      };
    }),
  };
  if (!apply) {
    console.log("dry run - pass --apply to upload and write src/data/eeg-gallery.json");
    return;
  }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: buckets, error: be } = await sb.storage.listBuckets();
  if (be) throw be;
  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error } = await sb.storage.createBucket(BUCKET, { public: false });
    if (error) throw error;
    console.log(`created private bucket ${BUCKET}`);
  } else if (buckets.find((b) => b.name === BUCKET)?.public) {
    throw new Error(`bucket ${BUCKET} is public; the gallery is editor-only`);
  }
  let n = 0;
  for (const it of out.items) {
    for (const [file, path, type] of [
      [`${it.id}.png`, it.path, "image/png"], [`${it.id}.w800.webp`, it.thumbPath, "image/webp"],
    ] as const) {
      const { error } = await sb.storage.from(BUCKET).upload(path, readFileSync(join(dir, "renders", file)), {
        contentType: type, upsert: true, cacheControl: "31536000",
      });
      if (error) throw new Error(`${path}: ${error.message}`);
      n += 1;
    }
  }
  writeFileSync(join(process.cwd(), "src", "data", "eeg-gallery.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`uploaded ${n} objects; wrote src/data/eeg-gallery.json (${out.items.length} items)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
