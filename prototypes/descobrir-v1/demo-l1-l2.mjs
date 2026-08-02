#!/usr/bin/env node
/**
 * Demo L1→L2 (Tarefa 4/5, parte "wiring") — compõe os cores determinísticos
 * sobre o par real zul-tax → tax-provider-rj e GERA o system-graph.
 *
 * As boundary facts abaixo foram extraídas À MÃO desta sessão (lendo o código):
 * o extrator multi-stack (Explorer-sobre-Graphify) que as produziria
 * automaticamente é o build grande, ainda gated na decisão de store. Aqui prova-se
 * que, DADAS as boundary facts, os cores (route-matcher + macro-flow-chainer)
 * produzem o system-graph — reproduzível, sem hand-writing do resultado.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { matchRoutes } from "./src/route-matcher.mjs";
import { chainMacroFlows } from "./src/macro-flow-chainer.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// --- boundary facts (hand-sourced; pending automated extractor) ---
const outboundCalls = [
  { method: "POST", path: "/private/debits/{state}/{category}/pay", symbol: "ZulTaxProvider.payDebit", provenance: "zul-tax:ZulTaxProvider.kt#L603-L607" },
  { method: "GET", path: "/private/debits/{state}/payment/external-id/{externalId}/status", symbol: "ZulTaxProvider.getPaymentStatus", provenance: "zul-tax:ZulTaxProvider.kt#L484" },
  { method: "GET", path: "/private/debits/{state}/{category}/payment/external-id/{externalId}/details", symbol: "ZulTaxProvider.getPayment", provenance: "zul-tax:ZulTaxProvider.kt#L651" },
  { method: "GET", path: "/private/debits/{state}/payment/{externalId}/receipt/download", symbol: "ZulTaxProvider.getPaymentReceipt", provenance: "zul-tax:ZulTaxProvider.kt#L79" },
  { method: "GET", path: "/private/payment-provider/{partner}/balance", symbol: "ZulTaxProvider.retrieveAccountBalance", provenance: "zul-tax:ZulTaxProvider.kt#L67" },
];

const exposedEndpoints = [
  { method: "POST", path: "/private/debits/{state}/{debitType}/pay", handler: "payDebit", provenance: "tax-provider-rj:PrivateDebitController.kt" },
  { method: "GET", path: "/private/debits/{state}/payment/external-id/{externalId}/status", handler: "retrievePaymentStatus", provenance: "tax-provider-rj:PrivateDebitController.kt" },
  { method: "GET", path: "/private/debits/{state}/{debitType}/payment/external-id/{externalId}/details", handler: "retrievePaymentDetails", provenance: "tax-provider-rj:PrivateDebitController.kt" },
  { method: "GET", path: "/private/debits/{state}/payment/{externalId}/receipt/download", handler: "downloadPaymentReceipt", provenance: "tax-provider-rj:PrivateDebitController.kt" },
  { method: "GET", path: "/private/debits/{state}/{debitType}/registration-plate/{registrationPlate}/registration-code/{registrationCode}", handler: "retrieveDebits", provenance: "tax-provider-rj:PrivateDebitController.kt" },
];

// flow membership (hand-sourced; some unmapped on purpose to show recall)
const clientSymbolToFlow = {
  "ZulTaxProvider.payDebit": "flow:pagamento-tributos",
  "ZulTaxProvider.getPaymentReceipt": "flow:pagamento-tributos",
};
const serverHandlerToFlow = {
  payDebit: "flow:post-pay-debit", // endpoints.md → flows/post-pay-debit.md
  downloadPaymentReceipt: "flow:get-download-receipt", // endpoints.md → flows/get-download-receipt.md
};

// --- L1: match routes ---
const l1 = matchRoutes({
  outboundCalls,
  exposedEndpoints,
  fromNamespace: "zul-tax",
  toNamespace: "tax-provider-rj",
  binding: "TAX_PROVIDER_RJ_URL",
});

// --- L2: chain micro-flows into macro-flows ---
const l2 = chainMacroFlows({
  edges: l1.edges,
  clientSymbolToFlow,
  serverHandlerToFlow,
});

const systemGraph = {
  _comment: "GERADO pelos cores (route-matcher + macro-flow-chainer) sobre boundary facts reais hand-sourced. Reproduzível: node demo-l1-l2.mjs.",
  kind: "system-graph",
  services: ["zul-tax", "tax-provider-rj"],
  l1_edges: l1.edges,
  l1_unmatched: l1.unmatched,
  l2_macro_flows: l2.chains,
  l2_unresolved: l2.unresolved,
};

const outPath = join(here, "output", "system-graph-zul-tax-tax-provider-rj.json");
writeFileSync(outPath, `${JSON.stringify(systemGraph, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

process.stdout.write(
  `${JSON.stringify({
    l1_edges: l1.edges.length,
    l1_unmatched: l1.unmatched.length,
    l2_macro_flows: l2.chains.length,
    l2_unresolved: l2.unresolved.length,
    macro_flows: l2.chains.map((c) => `${c.from_flow.namespace}:${c.from_flow.id} → ${c.to_flow.namespace}:${c.to_flow.id}`),
  })}\n`,
);
