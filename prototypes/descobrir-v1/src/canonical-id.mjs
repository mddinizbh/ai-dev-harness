/**
 * Canonical ID generation for Descobrir v1 (ADR 0002).
 *
 * Deterministic, type-prefixed IDs unique within a Knowledge Namespace.
 * Derivation excludes machine paths, source_revision, engine identity and
 * timestamps — only type + normalized natural key (records) or
 * relation_type + from + to (relations) participate.
 *
 * Normalization is environment-independent: Unicode NFC, trim, lowercase,
 * collapse internal whitespace runs to a single '-'. Meaningful separators
 * (/, :, ., _, {, }, -) pass through untouched.
 */
export class CanonicalIdError extends Error {
  constructor(message) {
    super(message);
    this.name = "CanonicalIdError";
  }
}

function normalize(segment) {
  return segment.normalize("NFC").trim().toLowerCase().replace(/\s+/g, "-");
}

function requireNonEmpty(normalized, label) {
  if (normalized === "") {
    throw new CanonicalIdError(`canonical id ${label} is empty after normalization`);
  }
}

export function canonicalRecordId(type, naturalKey) {
  const normalizedType = normalize(type);
  const normalizedKey = normalize(naturalKey);
  requireNonEmpty(normalizedType, "type");
  requireNonEmpty(normalizedKey, "natural_key");
  return `${normalizedType}:${normalizedKey}`;
}

export function canonicalRelationId(relationType, fromRecord, toRecord) {
  const normalizedType = normalize(relationType);
  const from = normalize(fromRecord);
  const to = normalize(toRecord);
  requireNonEmpty(normalizedType, "relation_type");
  requireNonEmpty(from, "from_record");
  requireNonEmpty(to, "to_record");
  return `${normalizedType}:${from}->${to}`;
}
