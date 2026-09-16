import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import imageSchema from "../../../content/qbank/schema/render-image.schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(imageSchema);

function describe(error: ErrorObject): string {
  const path = error.instancePath ? `image${error.instancePath.replaceAll("/", ".")}` : "image";
  return `${path} ${error.message ?? "is invalid"}`;
}

/** Exact structural validation shared with the Python renderer. */
export function validateRenderImage(image: unknown): string[] {
  return validate(image) ? [] : (validate.errors ?? []).map(describe);
}
