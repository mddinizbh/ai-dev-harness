/**
 * Zero-dependency JSON Schema interpreter for the Descobrir contract subset.
 * Draft 2020-12 applicator semantics for local $ref + listed keywords only.
 */

import { interpret, validateInstance } from "./interpret-core.mjs";

export const SUPPORTED_KEYWORDS = Object.freeze([
  "$ref",
  "type",
  "required",
  "properties",
  "additionalProperties",
  "enum",
  "const",
  "pattern",
  "minLength",
  "minItems",
  "minimum",
  "maximum",
  "items",
  "contains",
  "minContains",
  "propertyNames",
  "oneOf",
  "allOf",
  "if",
  "then",
]);

export { interpret, validateInstance };
