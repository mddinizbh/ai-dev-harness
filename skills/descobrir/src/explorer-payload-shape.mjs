/**
 * Explorer payload shape: field allow-lists, authority/injection guards, and
 * per-payload blocker collection. The Explorer is untrusted and stochastic, so
 * every violation becomes a deterministic blocker object instead of trusted data.
 */

import { validateExplorerPayloadSchema } from "./schema/explorer-payload.mjs";

export const PAYLOAD_KEYS = new Set(["chunk_key", "records", "relations"]);

export const RECORD_KEYS = new Set([
  "node_key",
  "type",
  "natural_key",
  "name",
  "summary",
  "attributes",
]);

export const RELATION_KEYS = new Set([
  "edge_key",
  "relation_type",
  "from_type",
  "from_natural_key",
  "to_type",
  "to_natural_key",
]);

// Authority/derived fields owned by deterministic prepare/finalize.
// None may appear in an Explorer payload at any level.
const BANNED_AUTHORITY = new Set([
  "id",
  "namespace",
  "source_revision",
  "source_engine",
  "status",
  "evidence",
  "manifest_id",
  "artifact_manifest",
  "artifact_manifest_id",
  "artifact_path",
  "content_sha256",
  "canonical_graph_hash",
  "graph_index",
  "graph_index_id",
  "coverage_report",
  "coverage",
  "confidence",
  "accepted",
  "approver",
  "passed",
  "from_record",
  "to_record",
  "source_path",
  "path",
  "uri",
  "repository",
]);

const STRING_MAX = 512;
const MAX_ATTRIBUTES = 32;
const SHA256_RE = /^[a-f0-9]{64}$/;
const CONTROL_RE = /[\u0000-\u001f]/;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {string} code
 * @param {string[]} chunkKeys
 * @param {string} detail
 * @param {boolean} retryable
 */
export function blocker(code, chunkKeys, detail, retryable) {
  return { code, chunk_keys: [...chunkKeys].sort(), detail, retryable };
}

/**
 * Return a reason when a string value is shaped like authority a deterministic
 * stage owns (path, repository reference, or content hash), else null.
 * @param {unknown} value
 * @returns {string|null}
 */
export function authorityShape(value) {
  if (typeof value !== "string") return null;
  if (value.length > STRING_MAX) return "an over-length value";
  if (CONTROL_RE.test(value)) return "control characters";
  if (/^\//.test(value)) return "an absolute path";
  if (/^[A-Za-z]:[\\/]/.test(value)) return "a filesystem path";
  if (/\\/.test(value)) return "a backslash path separator";
  if (/(^|\/)\.\.(\/|$)/.test(value)) return "a path traversal";
  if (/repo:\/\//.test(value)) return "a repository reference";
  if (SHA256_RE.test(value)) return "a content hash";
  return null;
}

/**
 * @param {Record<string, unknown>} obj
 * @param {Set<string>} allowed
 * @param {string} label
 * @param {string[]} scope
 * @param {boolean} retryable
 * @param {object[]} out
 */
function scanKeys(obj, allowed, label, scope, retryable, out) {
  for (const key of Object.keys(obj).sort()) {
    if (BANNED_AUTHORITY.has(key)) {
      out.push(blocker("banned_field", scope, `${label}: authority field '${key}' is not allowed`, retryable));
    } else if (!allowed.has(key)) {
      out.push(blocker("unknown_field", scope, `${label}: unknown field '${key}'`, retryable));
    }
  }
}

/**
 * @param {Record<string, unknown>} value
 * @param {string} label
 * @param {string[]} scope
 * @param {boolean} retryable
 * @param {object[]} out
 */
function scanAttributes(value, label, scope, retryable, out) {
  if (!isPlainObject(value)) {
    out.push(blocker("invalid_shape", scope, `${label}.attributes must be an object`, retryable));
    return;
  }
  const keys = Object.keys(value);
  if (keys.length > MAX_ATTRIBUTES) {
    out.push(blocker("invalid_shape", scope, `${label}.attributes exceeds ${MAX_ATTRIBUTES} entries`, retryable));
  }
  for (const key of keys.sort()) {
    if (BANNED_AUTHORITY.has(key)) {
      out.push(blocker("banned_field", scope, `${label}.attributes: authority field '${key}' is not allowed`, retryable));
      continue;
    }
    const reason = authorityShape(value[key]);
    if (reason !== null) {
      out.push(blocker("banned_field", scope, `${label}.attributes.${key} looks like ${reason}`, retryable));
    }
  }
}

/**
 * Guard the string values of an entity's own allowed fields.
 * @param {Record<string, unknown>} item
 * @param {Set<string>} allowed
 * @param {string} label
 * @param {string[]} scope
 * @param {boolean} retryable
 * @param {object[]} out
 */
function scanValues(item, allowed, label, scope, retryable, out) {
  for (const key of Object.keys(item).sort()) {
    if (!allowed.has(key) || BANNED_AUTHORITY.has(key)) continue;
    if (key === "attributes") {
      scanAttributes(/** @type {Record<string, unknown>} */ (item[key]), label, scope, retryable, out);
      continue;
    }
    const reason = authorityShape(item[key]);
    if (reason !== null) {
      out.push(blocker("banned_field", scope, `${label}.${key} looks like ${reason}`, retryable));
    }
  }
}

/**
 * @param {unknown} items
 * @param {string} label
 * @param {Set<string>} allowed
 * @param {string[]} scope
 * @param {boolean} retryable
 * @param {object[]} out
 */
function scanEntities(items, label, allowed, scope, retryable, out) {
  if (items === undefined) return;
  if (!Array.isArray(items)) {
    out.push(blocker("invalid_shape", scope, `${label}s must be an array`, retryable));
    return;
  }
  for (const item of items) {
    if (!isPlainObject(item)) {
      out.push(blocker("invalid_shape", scope, `${label} must be an object`, retryable));
      continue;
    }
    scanKeys(item, allowed, label, scope, retryable, out);
    scanValues(item, allowed, label, scope, retryable, out);
  }
}

/**
 * Validate one untrusted Explorer payload into deterministic blockers.
 * @param {unknown} payload
 * @returns {Array<{ code: string, chunk_keys: string[], detail: string, retryable: boolean }>}
 */
export function collectPayloadBlockers(payload) {
  if (!isPlainObject(payload)) {
    return [blocker("invalid_shape", [], "payload must be a JSON object", false)];
  }
  const chunkKey = typeof payload.chunk_key === "string" ? payload.chunk_key : null;
  const scope = chunkKey === null ? [] : [chunkKey];
  const retryable = chunkKey !== null;
  const out = [];

  scanKeys(payload, PAYLOAD_KEYS, "payload", scope, retryable, out);
  if (chunkKey === null) {
    out.push(blocker("invalid_shape", scope, "payload.chunk_key must be a non-empty string", false));
  } else if (authorityShape(chunkKey) !== null) {
    out.push(blocker("banned_field", scope, "payload.chunk_key looks like a path or hash", false));
  }
  scanEntities(payload.records, "record", RECORD_KEYS, scope, retryable, out);
  scanEntities(payload.relations, "relation", RELATION_KEYS, scope, retryable, out);

  // Closed-schema backstop: reject anything the imperative scan missed.
  if (out.length === 0 && !validateExplorerPayloadSchema(payload).valid) {
    out.push(blocker("invalid_shape", scope, "payload violates the closed schema", retryable));
  }
  return out;
}
