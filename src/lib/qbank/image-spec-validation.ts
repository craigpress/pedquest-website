import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import imageSchema from "../../../content/qbank/schema/render-image.schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(imageSchema);

function describe(error: ErrorObject, root = "image"): string {
  const path = error.instancePath ? `${root}${error.instancePath.replaceAll("/", ".")}` : root;
  const extra = error.keyword === "additionalProperties"
    ? ` (${String((error.params as { additionalProperty?: string }).additionalProperty)})`
    : error.keyword === "enum"
      ? ` (${((error.params as { allowedValues?: unknown[] }).allowedValues ?? []).map(String).slice(0, 12).join(", ")})`
      : "";
  return `${path} ${error.message ?? "is invalid"}${extra}`;
}

/** Exact structural validation shared with the Python renderer. */
export function validateRenderImage(image: unknown): string[] {
  return validate(image) ? [] : (validate.errors ?? []).map((e) => describe(e));
}

// Per-kind spec schemas, taken from the image schema's `oneOf` so there is one
// source (content/qbank/schema/render-image.schema.json, written from the
// renderer's schema.py). Validating the spec against its own kind's schema
// reports "spec.events.0 must NOT have additional properties (foo)" instead of
// every other kind's branch failing as well.
type Branch = { properties?: { kind?: { const?: string }; spec?: object } };
const specValidators = new Map<string, ValidateFunction>();
for (const group of (imageSchema as { allOf?: { oneOf?: Branch[] }[] }).allOf ?? []) {
  for (const branch of group.oneOf ?? []) {
    const kind = branch.properties?.kind?.const;
    if (kind && branch.properties?.spec) specValidators.set(kind, ajv.compile(branch.properties.spec));
  }
}

const MAX_SPEC_ERRORS = 12;

/** Structural errors of a lab image block's spec against the renderer schema for its kind (capped). */
export function validateRenderSpec(kind: unknown, spec: unknown): string[] {
  const check = typeof kind === "string" ? specValidators.get(kind) : undefined;
  if (!check) return [];
  if (check(spec)) return [];
  const seen = new Set<string>();
  for (const e of check.errors ?? []) {
    // oneOf/anyOf wrappers repeat what their branches already said
    if (e.keyword === "oneOf" || e.keyword === "anyOf" || e.keyword === "if") continue;
    seen.add(describe(e, "spec"));
    if (seen.size >= MAX_SPEC_ERRORS) break;
  }
  return [...seen];
}
