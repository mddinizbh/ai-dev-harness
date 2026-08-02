import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { MutationEvidenceError, mutationEvidence } from "../src/mutation.mjs";

const SHA = "a".repeat(64);

function snap(overrides = {}) {
  return {
    summary_hash: SHA,
    tracked_file_count: 2,
    dirty_path_count: 1,
    anchor_object_present: true,
    ...overrides,
  };
}

describe("mutationEvidence", () => {
  test("returns schema-shaped evidence and equivalent=true for identical snapshots", () => {
    assert.deepStrictEqual(mutationEvidence(snap(), snap()), {
      pre: snap(),
      post: snap(),
      equivalent: true,
    });
  });

  test("returns equivalent=false when any mutation-relevant surface differs", () => {
    for (const delta of [
      { summary_hash: "b".repeat(64) },
      { tracked_file_count: 3 },
      { dirty_path_count: 2 },
      { anchor_object_present: false },
    ]) {
      assert.strictEqual(mutationEvidence(snap(), snap(delta)).equivalent, false);
    }
  });

  test("rejects malformed input with typed errors", () => {
    assert.throws(() => mutationEvidence(null, snap()), MutationEvidenceError);
    assert.throws(() => mutationEvidence(snap(), { summary_hash: "x" }), MutationEvidenceError);
    assert.throws(
      () => mutationEvidence(snap(), snap({ dirty_path_count: -1 })),
      MutationEvidenceError,
    );
  });
});
