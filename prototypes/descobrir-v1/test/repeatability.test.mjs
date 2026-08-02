import assert from "node:assert/strict";
import { describe, test } from "node:test";

// Seam under test: pure repeatability comparison for Descobrir v1.
// Module does not exist yet — this import MUST fail first (RED), then pass.
import { RepeatabilityError, repeatabilityResult } from "../src/repeatability.mjs";

const SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);

describe("repeatabilityResult", () => {
  test("returns a schema-shaped pass result when hashes match", () => {
    assert.deepStrictEqual(repeatabilityResult(SHA, SHA), {
      result: "pass",
      canonical_graph_hash: SHA,
      baseline_hash: SHA,
    });
  });

  test("returns a schema-shaped fail result with deterministic details when hashes differ", () => {
    assert.deepStrictEqual(repeatabilityResult(SHA, OTHER_SHA), {
      result: "fail",
      canonical_graph_hash: SHA,
      baseline_hash: OTHER_SHA,
      details: `canonical_graph_hash mismatch: ${SHA} !== ${OTHER_SHA}`,
    });
  });

  test("rejects uppercase SHA-256 input with a typed error", () => {
    assert.throws(() => repeatabilityResult(SHA.toUpperCase(), SHA), RepeatabilityError);
    assert.throws(() => repeatabilityResult(SHA, OTHER_SHA.toUpperCase()), RepeatabilityError);
  });
});
