import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bindJourney } from "../src/journey-bind.mjs";

describe("bindJourney", () => {
  test("binds matching step and reports gap", () => {
    const edges = [
      {
        edge_id: "e1",
        from: { logical_repo: "a" },
        to: { logical_repo: "b" },
        contract_key: "GET /api/x",
        match_kind: "config_binding",
        score: 0.95,
      },
    ];
    const r = bindJourney(
      {
        id: "j1",
        system_namespace: "sys",
        members: ["a", "b"],
        steps: [
          {
            id: "s1",
            trigger: "http-sync",
            from: "a",
            to: "b",
            contract_prefix: "GET /api",
          },
          {
            id: "s2",
            trigger: "http-sync",
            from: "a",
            to: "b",
            contract_key: "POST /missing",
          },
        ],
      },
      edges,
    );
    assert.equal(r.steps_bound, 1);
    assert.equal(r.steps_gap, 1);
    assert.equal(r.status, "partial");
  });
});
