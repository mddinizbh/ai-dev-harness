import assert from "node:assert/strict";
import { describe, test } from "node:test";

// Seam under test (L2 core): the macro-flow chainer. Given L1 CALLS edges plus
// each side's flow membership (client symbol → flow; server handler → flow via
// TRIGGERS), chain the micro-flows into macro-flows that cross services.
// Deterministic; no store/LLM. Handles fan-out (branch → DAG) and surfaces
// unresolved edges (recall). Fixture = the real payDebit edge this session.
import { chainMacroFlows } from "../src/macro-flow-chainer.mjs";

const PAY_EDGE = {
  relation_type: "CALLS",
  evidence_class: "contract-matched",
  from_namespace: "zul-tax",
  to_namespace: "tax-provider-rj",
  route: "POST /private/debits/{state}/{debitType}/pay",
  binding: "TAX_PROVIDER_RJ_URL",
  client: { symbol: "ZulTaxProvider.payDebit" },
  server: { handler: "payDebit" },
};

describe("chainMacroFlows — reproduces the real cross-service macro-flow", () => {
  const result = chainMacroFlows({
    edges: [PAY_EDGE],
    clientSymbolToFlow: { "ZulTaxProvider.payDebit": "flow:pagamento-tributos" },
    serverHandlerToFlow: { payDebit: "flow:post-pay-debit" },
  });

  test("chains zul-tax:pagamento-tributos → tax-provider-rj:post-pay-debit", () => {
    assert.strictEqual(result.chains.length, 1);
    const c = result.chains[0];
    assert.deepStrictEqual(c.from_flow, { namespace: "zul-tax", id: "flow:pagamento-tributos" });
    assert.deepStrictEqual(c.to_flow, { namespace: "tax-provider-rj", id: "flow:post-pay-debit" });
    assert.strictEqual(c.via.binding, "TAX_PROVIDER_RJ_URL");
    assert.strictEqual(c.evidence_class, "contract-matched");
    assert.ok(!c.branch);
  });

  test("no unresolved edges when both sides map", () => {
    assert.deepStrictEqual(result.unresolved, []);
  });
});

describe("chainMacroFlows — fan-out is a DAG", () => {
  test("one edge whose server handler triggers 2 flows emits 2 branches", () => {
    const r = chainMacroFlows({
      edges: [PAY_EDGE],
      clientSymbolToFlow: { "ZulTaxProvider.payDebit": "flow:pagamento-tributos" },
      serverHandlerToFlow: { payDebit: ["flow:post-pay-debit", "flow:audit-payment"] },
    });
    assert.strictEqual(r.chains.length, 2);
    assert.ok(r.chains.every((c) => c.branch === true));
    assert.deepStrictEqual(
      r.chains.map((c) => c.to_flow.id).sort(),
      ["flow:audit-payment", "flow:post-pay-debit"],
    );
  });
});

describe("chainMacroFlows — recall (never silently drop)", () => {
  test("edge whose client symbol has no flow is surfaced as unresolved", () => {
    const r = chainMacroFlows({
      edges: [PAY_EDGE],
      clientSymbolToFlow: {},
      serverHandlerToFlow: { payDebit: "flow:post-pay-debit" },
    });
    assert.strictEqual(r.chains.length, 0);
    assert.strictEqual(r.unresolved.length, 1);
    assert.strictEqual(r.unresolved[0].reason, "client-symbol-not-in-any-flow");
  });

  test("edge whose server handler triggers no flow is surfaced as unresolved", () => {
    const r = chainMacroFlows({
      edges: [PAY_EDGE],
      clientSymbolToFlow: { "ZulTaxProvider.payDebit": "flow:pagamento-tributos" },
      serverHandlerToFlow: {},
    });
    assert.strictEqual(r.chains.length, 0);
    assert.strictEqual(r.unresolved[0].reason, "server-handler-triggers-no-flow");
  });
});
