import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CanonicalIdError,
  canonicalRecordId,
  canonicalRelationId,
} from "../src/canonical-id.mjs";

describe("canonicalRecordId", () => {
  test("derives type-prefixed id from type + natural_key", () => {
    assert.equal(canonicalRecordId("Service", "Billing API"), "service:billing-api");
  });

  test("is environment-independent (NFC, trim, lowercase, collapse space)", () => {
    // whitespace runs collapse to a single '-'; '/' is preserved
    assert.equal(canonicalRecordId("  Endpoint ", " Get  /orders "), "endpoint:get-/orders");
  });

  test("rejects empty segments after normalization", () => {
    assert.throws(() => canonicalRecordId("   ", "x"), CanonicalIdError);
    assert.throws(() => canonicalRecordId("Service", "   "), CanonicalIdError);
  });
});

describe("canonicalRelationId", () => {
  test("derives deterministic relation id", () => {
    assert.equal(
      canonicalRelationId("EXPOSES", "service:billing", "endpoint:get:/billing"),
      "exposes:service:billing->endpoint:get:/billing",
    );
  });

  test("rejects empty parts", () => {
    assert.throws(() => canonicalRelationId("", "a", "b"), CanonicalIdError);
  });
});
