import { describe, test } from "node:test";
import assert from "node:assert/strict";

// Seam under test (pre-agreed, ADR 0002): deterministic type-prefixed Canonical
// IDs, unique within namespace, excluding machine paths/revision/engine.
// Module does not exist yet — this import MUST fail first (RED), then pass.
import {
  canonicalRecordId,
  canonicalRelationId,
  CanonicalIdError,
} from "../src/canonical-id.mjs";

describe("canonicalRecordId", () => {
  test("derives type-prefixed id from Endpoint type and HTTP route natural key", () => {
    // Given a Record type and a route-style natural key
    // When the canonical id is derived
    // Then type is lowercased and joined to the lowercased key by ':'
    assert.strictEqual(
      canonicalRecordId("Endpoint", "POST:/api/v1/iam/auth/register"),
      "endpoint:post:/api/v1/iam/auth/register",
    );
  });

  test("produces a stable id regardless of surrounding whitespace and letter case", () => {
    // Given the same logical record expressed with dirty casing and whitespace
    const clean = canonicalRecordId("Endpoint", "POST:/api/v1/iam/auth/register");
    const dirty = canonicalRecordId("  Endpoint  ", "\n\tPOST:/api/v1/iam/auth/register ");
    // Then both collapse to the same canonical id
    assert.strictEqual(dirty, clean);
  });

  test("collapses internal whitespace runs to a single dash while preserving separators", () => {
    // Given a natural key with internal whitespace
    // When normalized
    // Then each whitespace run becomes one '-' and letters are lowercased
    assert.strictEqual(
      canonicalRecordId("Service", "iam   events   register"),
      "service:iam-events-register",
    );
  });

  test("preserves meaningful separators / : . _ { } - inside the natural key", () => {
    // Given a natural key carrying every preserved separator
    // When normalized
    // Then separators pass through untouched
    assert.strictEqual(
      canonicalRecordId("Event", "iam/events/register/v1.event_{shard-1}:prod"),
      "event:iam/events/register/v1.event_{shard-1}:prod",
    );
  });

  test("applies Unicode NFC before lowercasing so decomposed input composes", () => {
    // Given an NFD-decomposed input (e + combining acute)
    // When normalized
    // Then it composes to NFC then lowercases
    const decomposedType = "Caf\u0065\u0301"; // "Café" in NFD
    assert.strictEqual(canonicalRecordId(decomposedType, "key"), "café:key");
  });
});

describe("canonicalRelationId", () => {
  test("derives type-prefixed relation id from relation_type + from + to", () => {
    // Given a relation type and two canonical record ids
    // When the relation id is derived
    // Then it is lowercased-type ':' from '->' to
    assert.strictEqual(
      canonicalRelationId("PUBLISHES", "service:iam", "event:iam/events/register/v1.event"),
      "publishes:service:iam->event:iam/events/register/v1.event",
    );
  });

  test("normalizes relation_type, from_record and to_record the same way as records", () => {
    // Given dirty casing/whitespace on all three parts
    // When normalized
    // Then it equals the clean relation id
    assert.strictEqual(
      canonicalRelationId("  PUBLISHES ", "Service:IAM", "Event:iam/events/register/v1.event"),
      "publishes:service:iam->event:iam/events/register/v1.event",
    );
  });
});

describe("rejection of empty inputs", () => {
  test("rejects empty record type with CanonicalIdError", () => {
    assert.throws(() => canonicalRecordId("", "key"), CanonicalIdError);
  });

  test("rejects empty record natural key with CanonicalIdError", () => {
    assert.throws(() => canonicalRecordId("type", ""), CanonicalIdError);
  });

  test("rejects whitespace-only record key (normalizes to empty) with CanonicalIdError", () => {
    assert.throws(() => canonicalRecordId("type", "   "), CanonicalIdError);
  });

  test("rejects empty relation type with CanonicalIdError", () => {
    assert.throws(() => canonicalRelationId("", "from", "to"), CanonicalIdError);
  });

  test("rejects empty relation from_record with CanonicalIdError", () => {
    assert.throws(() => canonicalRelationId("rel", "", "to"), CanonicalIdError);
  });

  test("rejects empty relation to_record with CanonicalIdError", () => {
    assert.throws(() => canonicalRelationId("rel", "from", ""), CanonicalIdError);
  });
});
