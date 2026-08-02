/**
 * Canonical ID generation for Descobrir (ADR 0002).
 * Deterministic, type-prefixed IDs unique within a Knowledge Namespace.
 */

import { CanonicalIdError } from "./errors.mjs";

export { CanonicalIdError };

/**
 * @param {string} segment
 * @returns {string}
 */
function normalize(segment) {
  return segment.normalize("NFC").trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * @param {string} normalized
 * @param {string} label
 */
function requireNonEmpty(normalized, label) {
  if (normalized === "") {
    throw new CanonicalIdError(`canonical id ${label} is empty after normalization`);
  }
}

/**
 * @param {string} type
 * @param {string} naturalKey
 * @returns {string}
 */
export function canonicalRecordId(type, naturalKey) {
  const normalizedType = normalize(type);
  const normalizedKey = normalize(naturalKey);
  requireNonEmpty(normalizedType, "type");
  requireNonEmpty(normalizedKey, "natural_key");
  return `${normalizedType}:${normalizedKey}`;
}

/**
 * @param {string} relationType
 * @param {string} fromRecord
 * @param {string} toRecord
 * @returns {string}
 */
export function canonicalRelationId(relationType, fromRecord, toRecord) {
  const normalizedType = normalize(relationType);
  const from = normalize(fromRecord);
  const to = normalize(toRecord);
  requireNonEmpty(normalizedType, "relation_type");
  requireNonEmpty(from, "from_record");
  requireNonEmpty(to, "to_record");
  return `${normalizedType}:${from}->${to}`;
}
