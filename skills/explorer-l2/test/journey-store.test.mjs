import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { bindJourney } from "../src/journey-bind.mjs";
import {
  journeysForEdge,
  listJourneys,
  openJourneyStore,
  persistJourneyBind,
  showJourney,
} from "../src/journey-store.mjs";

describe("journey-store", () => {
  test("persist bind + list + show + journeys-for-edge", () => {
    const dir = mkdtempSync(join(tmpdir(), "l2-store-"));
    const dbPath = join(dir, "t.sqlite");
    try {
      const store = openJourneyStore(dbPath);
      const edges = [
        {
          edge_id: "l1:edge-a",
          from: { logical_repo: "zul-tax" },
          to: { logical_repo: "tax-provider-controller" },
          contract_key: "GET /api/debits/x",
          match_kind: "config_binding",
          score: 0.95,
        },
      ];
      const spec = {
        id: "journey-consulta-debitos",
        system_namespace: "estapar-system",
        members: ["zul-tax", "tax-provider-controller"],
        steps: [
          {
            id: "tax-tpc",
            trigger: "http-sync",
            from: "zul-tax",
            to: "tax-provider-controller",
            contract_prefix: "GET /api/debits",
          },
          {
            id: "missing",
            trigger: "internal",
            from: "zul-tax",
            to: "zul-tax",
          },
        ],
      };
      const bind = bindJourney(spec, edges);
      const persisted = persistJourneyBind(store, { spec, bind });
      assert.equal(persisted.bind_created, true);
      assert.ok(persisted.bind_id.includes("journey-consulta-debitos"));

      const listed = listJourneys(store, "estapar-system");
      assert.equal(listed.length, 1);
      assert.equal(listed[0].journey_id, "journey-consulta-debitos");
      assert.equal(listed[0].steps_bound, 1);
      assert.equal(listed[0].steps_gap, 1);

      const shown = showJourney(store, {
        system_namespace: "estapar-system",
        journey_id: "journey-consulta-debitos",
      });
      assert.ok(shown);
      assert.equal(shown.journey_id, "journey-consulta-debitos");
      assert.equal(shown.spec.id, "journey-consulta-debitos");
      assert.ok(shown.step_edges.some((s) => s.edge_id === "l1:edge-a"));

      const hits = journeysForEdge(store, {
        system_namespace: "estapar-system",
        edge_id: "l1:edge-a",
      });
      assert.equal(hits.length, 1);
      assert.equal(hits[0].step_id, "tax-tpc");
      assert.equal(hits[0].is_current, true);

      // idempotent re-persist
      const again = persistJourneyBind(store, { spec, bind });
      assert.equal(again.bind_created, false);
      assert.equal(listJourneys(store, "estapar-system").length, 1);

      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
