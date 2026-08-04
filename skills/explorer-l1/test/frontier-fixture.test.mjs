import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dedupeFrontier } from "../src/frontier-extract.mjs";
import { matchFrontiers } from "../src/matcher.mjs";
import { contractKey } from "../src/path-normalize.mjs";

/**
 * Synthetic Estapar-shaped facts (no real monorepo in unit CI).
 */
describe("frontier fixture Estapar-shaped", () => {
  test("zul-tax outbound + controller inbound match on debits contract", () => {
    const ck = contractKey(
      "GET",
      "/api/debits/{state}/category/{category}/renavam/{renavam}",
    );
    const zul = dedupeFrontier([
      {
        kind: "http_outbound",
        namespace: "estapar",
        logical_repo: "zul-tax",
        source_revision: "abc",
        method: "GET",
        path: "/api/debits/{param}/category/{param}/renavam/{param}",
        contract_key: ck,
        config_key: "PROVIDERCONTROLLER_API_URL",
        file: "TaxProviderControllerClient.kt",
        line: 30,
        evidence_snippet: 'val url = "$taxProviderControllerURL/api/debits/..."',
        id: "ff:out:debits",
      },
    ]);
    const ctl = dedupeFrontier([
      {
        kind: "http_inbound",
        namespace: "estapar",
        logical_repo: "tax-provider-controller",
        source_revision: "def",
        method: "GET",
        path: "/api/debits/{param}/category/{param}/renavam/{param}",
        contract_key: ck,
        file: "DebitsController.java",
        line: 28,
        evidence_snippet:
          '@GetMapping("/{state}/category/{category}/renavam/{renavam}")',
        id: "ff:in:debits",
      },
    ]);
    assert.equal(zul.length, 1);
    assert.equal(ctl.length, 1);
    const edges = matchFrontiers(zul, ctl);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].match_kind, "config_binding");
    assert.match(edges[0].contract_key, /debits/);
  });
});
