import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { matchFrontiers } from "../src/matcher.mjs";
import { contractKey } from "../src/path-normalize.mjs";

function fact(partial) {
  return {
    namespace: "estapar",
    source_revision: "abc",
    file: "x.kt",
    line: 1,
    evidence_snippet: "snip",
    id: partial.id,
    ...partial,
  };
}

describe("matchFrontiers", () => {
  test("config binding scores higher than path-only", () => {
    const ck = contractKey(
      "GET",
      "/api/debits/{state}/category/{category}/renavam/{renavam}",
    );
    const from = [
      fact({
        id: "out1",
        kind: "http_outbound",
        logical_repo: "zul-tax",
        method: "GET",
        path: "/api/debits/{param}/category/{param}/renavam/{param}",
        contract_key: ck,
        config_key: "PROVIDERCONTROLLER_API_URL",
      }),
    ];
    const to = [
      fact({
        id: "in1",
        kind: "http_inbound",
        logical_repo: "tax-provider-controller",
        method: "GET",
        path: "/api/debits/{param}/category/{param}/renavam/{param}",
        contract_key: ck,
      }),
    ];
    const edges = matchFrontiers(from, to);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].match_kind, "config_binding");
    assert.ok(edges[0].score >= 0.9);
    assert.equal(edges[0].evidence_class, "contract-matched");
  });

  test("skips when config maps to a different target repo", () => {
    const ck = contractKey("GET", "/private/debits/{a}/{b}/pay");
    const from = [
      fact({
        id: "out2",
        kind: "http_outbound",
        logical_repo: "zul-tax",
        method: "GET",
        path: "/private/debits/{param}/{param}/pay",
        contract_key: ck,
        config_key: "TAX_PROVIDER_RJ_URL",
      }),
    ];
    const to = [
      fact({
        id: "in2",
        kind: "http_inbound",
        logical_repo: "tax-provider-controller",
        method: "GET",
        path: "/private/debits/{param}/{param}/pay",
        contract_key: ck,
      }),
    ];
    const edges = matchFrontiers(from, to);
    assert.equal(edges.length, 0);
  });
});
