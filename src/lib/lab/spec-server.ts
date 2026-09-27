// Server-side lab spec validation: the editor-facing checks of spec.ts plus
// the renderer's exact JSON schema (ajv), so a misspelled key or an unknown
// enum value is caught at enqueue instead of by `eeg-render validate` on the
// worker. Kept out of spec.ts so the /admin/eeg-lab client bundle does not
// ship ajv and the schema.

import { validateRenderSpec } from "@/lib/qbank/image-spec-validation";
import { validateLabSpec, type ValidateOptions } from "./spec";
import type { LabValidation } from "./types";

export function validateLabSpecStrict(block: unknown, opts: ValidateOptions = {}): LabValidation {
  const base = validateLabSpec(block, opts);
  if (typeof block !== "object" || block === null) return base;
  const b = block as { kind?: unknown; spec?: unknown };
  const structural = validateRenderSpec(b.kind, b.spec).map((e) => `Renderer schema: ${e}`);
  const errors = [...base.errors, ...structural];
  return { ...base, ok: errors.length === 0, errors };
}
