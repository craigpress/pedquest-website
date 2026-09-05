import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("invalid sidecar preflight stops import before Supabase access", () => {
  const dir = mkdtempSync(join(tmpdir(), "pedquest-qbank-import-"));
  const verifier = join(dir, "invalid-python.cmd");
  writeFileSync(verifier, "@echo invalid sidecar 1>&2\r\n@exit /b 1\r\n");
  chmodSync(verifier, 0o755);

  let error: any;
  try {
    execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/qbank-import.ts", "--only", "PQ-A-001"], {
      encoding: "utf8",
      env: { ...process.env, PYTHON: verifier, NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
      stdio: "pipe",
    });
  } catch (caught) {
    error = caught;
  }
  assert.equal(error?.status, 1);
  assert.match(`${error?.stdout ?? ""}${error?.stderr ?? ""}`, /Image verification failed/);
  assert.doesNotMatch(`${error?.stdout ?? ""}${error?.stderr ?? ""}`, /Supabase credentials/i);
});
