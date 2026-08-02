import assert from "node:assert/strict";
import { describe, test } from "node:test";

// Seam under test (L1 core): the route-matcher. Given a client service's
// outbound HTTP calls and a server service's exposed endpoints, produce
// cross-service CALLS edges by joining on METHOD + normalized path template
// (param NAMES ignored — match by structure). Deterministic; no store, no LLM.
// Fixture = the real zul-tax → tax-provider-rj pair verified by hand this session.
import { normalizeTemplate, matchRoutes } from "../src/route-matcher.mjs";

// Real outbound calls read from zul-tax ZulTaxProvider.kt (base = TAX_PROVIDER_RJ_URL).
const CLIENT = [
  { method: "POST", path: "/private/debits/{state}/{category}/pay", symbol: "ZulTaxProvider.payDebit", provenance: "zul-tax:ZulTaxProvider.kt#L603-L607" },
  { method: "GET", path: "/private/debits/{state}/payment/external-id/{externalId}/status", symbol: "getPaymentStatus", provenance: "zul-tax:ZulTaxProvider.kt#L484" },
  { method: "GET", path: "/private/debits/{state}/{category}/payment/external-id/{externalId}/details", symbol: "getPayment", provenance: "zul-tax:ZulTaxProvider.kt#L651" },
  { method: "GET", path: "/private/debits/{state}/payment/{externalId}/receipt/download", symbol: "getPaymentReceipt", provenance: "zul-tax:ZulTaxProvider.kt#L79" },
  { method: "GET", path: "/private/payment-provider/{partner}/balance", symbol: "retrieveAccountBalance", provenance: "zul-tax:ZulTaxProvider.kt#L67" },
];

// Real exposed endpoints from tax-provider-rj PrivateDebitController (prefix /private/debits).
const SERVER = [
  { method: "POST", path: "/private/debits/{state}/{debitType}/pay", handler: "payDebit" },
  { method: "GET", path: "/private/debits/{state}/payment/external-id/{externalId}/status", handler: "retrievePaymentStatus" },
  { method: "GET", path: "/private/debits/{state}/{debitType}/payment/external-id/{externalId}/details", handler: "retrievePaymentDetails" },
  { method: "GET", path: "/private/debits/{state}/payment/{externalId}/receipt/download", handler: "downloadPaymentReceipt" },
  { method: "GET", path: "/private/debits/{state}/{debitType}/registration-plate/{registrationPlate}/registration-code/{registrationCode}", handler: "retrieveDebits" },
  { method: "POST", path: "/private/debits/reject-payment/{debitType}/{externalId}", handler: "rejectPayment" },
];

describe("normalizeTemplate", () => {
  test("collapses param names to positional placeholders (match by structure)", () => {
    assert.strictEqual(
      normalizeTemplate("/private/debits/{state}/{category}/pay"),
      "/private/debits/{}/{}/pay",
    );
    assert.strictEqual(
      normalizeTemplate("/private/debits/{state}/{debitType}/pay"),
      "/private/debits/{}/{}/pay",
    );
  });

  test("client {category} and server {debitType} normalize equal", () => {
    assert.strictEqual(
      normalizeTemplate("/private/debits/{state}/{category}/payment/external-id/{externalId}/details"),
      normalizeTemplate("/private/debits/{state}/{debitType}/payment/external-id/{externalId}/details"),
    );
  });
});

describe("matchRoutes — reproduces the real zul-tax → tax-provider-rj edges", () => {
  const result = matchRoutes({
    outboundCalls: CLIENT,
    exposedEndpoints: SERVER,
    fromNamespace: "zul-tax",
    toNamespace: "tax-provider-rj",
    binding: "TAX_PROVIDER_RJ_URL",
  });

  test("produces exactly the 4 verified edges", () => {
    assert.strictEqual(result.edges.length, 4);
    const handlers = result.edges.map((e) => e.server.handler).sort();
    assert.deepStrictEqual(handlers, [
      "downloadPaymentReceipt",
      "payDebit",
      "retrievePaymentDetails",
      "retrievePaymentStatus",
    ]);
  });

  test("each edge is CALLS, contract-matched, carries both provenances + the binding", () => {
    for (const e of result.edges) {
      assert.strictEqual(e.relation_type, "CALLS");
      assert.strictEqual(e.evidence_class, "contract-matched");
      assert.strictEqual(e.from_namespace, "zul-tax");
      assert.strictEqual(e.to_namespace, "tax-provider-rj");
      assert.strictEqual(e.binding, "TAX_PROVIDER_RJ_URL");
      assert.ok(e.client.provenance && e.server.handler);
    }
  });

  test("the payDebit edge matches despite {category} vs {debitType}", () => {
    const pay = result.edges.find((e) => e.server.handler === "payDebit");
    assert.strictEqual(pay.client.symbol, "ZulTaxProvider.payDebit");
    assert.strictEqual(pay.method, "POST");
  });

  test("surfaces the unmatched outbound call (recall — never silently dropped)", () => {
    assert.strictEqual(result.unmatched.length, 1);
    assert.strictEqual(result.unmatched[0].symbol, "retrieveAccountBalance");
  });
});

describe("matchRoutes — discipline", () => {
  test("method mismatch on same path does not match", () => {
    const r = matchRoutes({
      outboundCalls: [{ method: "GET", path: "/x/{id}/pay", symbol: "c", provenance: "p" }],
      exposedEndpoints: [{ method: "POST", path: "/x/{id2}/pay", handler: "h" }],
      fromNamespace: "a", toNamespace: "b", binding: "URL",
    });
    assert.strictEqual(r.edges.length, 0);
    assert.strictEqual(r.unmatched.length, 1);
  });

  test("different segment count does not match", () => {
    const r = matchRoutes({
      outboundCalls: [{ method: "GET", path: "/x/{id}", symbol: "c", provenance: "p" }],
      exposedEndpoints: [{ method: "GET", path: "/x/{id}/extra", handler: "h" }],
      fromNamespace: "a", toNamespace: "b", binding: "URL",
    });
    assert.strictEqual(r.edges.length, 0);
  });

  test("ambiguous match (one call, two candidate endpoints) emits both, flagged", () => {
    const r = matchRoutes({
      outboundCalls: [{ method: "GET", path: "/x/{a}", symbol: "c", provenance: "p" }],
      exposedEndpoints: [
        { method: "GET", path: "/x/{b}", handler: "h1" },
        { method: "GET", path: "/x/{c}", handler: "h2" },
      ],
      fromNamespace: "a", toNamespace: "b", binding: "URL",
    });
    assert.strictEqual(r.edges.length, 2);
    assert.ok(r.edges.every((e) => e.ambiguous === true));
  });
});
