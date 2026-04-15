import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const TABLES = [
  "members",
  "publications",
  "abstracts",
  "member_documents",
  "publication_update_log",
  "membership_applications",
  "sponsor_inquiries",
  "contact_messages",
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment"
    );
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const date = new Date().toISOString().split("T")[0];
  const backupDir = path.resolve(__dirname, "../backups", date);
  fs.mkdirSync(backupDir, { recursive: true });

  console.log(`\nExporting Supabase data to ${backupDir}\n`);
  console.log("Table".padEnd(30) + "Rows");
  console.log("-".repeat(40));

  for (const table of TABLES) {
    try {
      const { data, error } = await supabase.from(table).select("*");

      if (error) {
        if (
          error.message.includes("does not exist") ||
          error.code === "42P01"
        ) {
          console.log(`${table.padEnd(30)}SKIPPED (table not found)`);
          continue;
        }
        throw error;
      }

      const rows = data ?? [];
      const outPath = path.join(backupDir, `${table}.json`);
      fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
      console.log(`${table.padEnd(30)}${rows.length}`);
    } catch (err: any) {
      console.error(`${table.padEnd(30)}ERROR: ${err.message}`);
    }
  }

  console.log(`\nBackup complete: ${backupDir}\n`);
}

main();
