import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import {
  exportFrontierFile,
  frontierFromPackage,
} from "../src/frontier-export.mjs";

const dir = mkdtempSync(join(tmpdir(), "ff-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("frontierFromPackage", () => {
  test("maps Endpoint natural_key get:/api/x to inbound", () => {
    const facts = frontierFromPackage({
      namespace: "demo",
      logical_repo: "svc-a",
      source_revision: "abc",
      records: [
        {
          type: "Endpoint",
          natural_key: "get:/api/debits/{id}",
          name: "debits",
          summary: "list debits",
          attributes: { file: "C.java", line: 10 },
        },
        {
          type: "Endpoint",
          natural_key: "out",
          name: "client",
          summary: "calls B",
          attributes: {
            direction: "outbound",
            method: "GET",
            path: "/api/debits/{id}",
            config_key: "B_URL",
            file: "Client.kt",
            line: 3,
          },
        },
      ],
    });
    assert.equal(facts.length, 2);
    const inn = facts.find((f) => f.kind === "http_inbound");
    const out = facts.find((f) => f.kind === "http_outbound");
    assert.ok(inn);
    assert.ok(out);
    assert.equal(inn.contract_key, out.contract_key);
    assert.equal(out.config_key, "B_URL");
  });

  test("exportFrontierFile writes json", () => {
    const pkgPath = join(dir, "pkg.json");
    writeFileSync(
      pkgPath,
      JSON.stringify({
        namespace: "demo",
        logical_repo: "svc-a",
        source_revision: "abc",
        frontier: [
          {
            kind: "http_inbound",
            namespace: "demo",
            logical_repo: "svc-a",
            source_revision: "abc",
            method: "GET",
            path: "/ping",
            contract_key: "GET /ping",
            file: "x",
            line: 1,
            evidence_snippet: "ping",
            id: "ff:in:1",
          },
        ],
        records: [],
      }),
    );
    const r = exportFrontierFile(pkgPath, dir);
    assert.equal(r.fact_count, 1);
    const body = JSON.parse(readFileSync(r.output, "utf8"));
    assert.equal(body.facts[0].contract_key, "GET /ping");
  });
});
