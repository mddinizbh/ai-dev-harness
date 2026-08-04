/**
 * L1 contract matcher — config-binding first, then path contract.
 */

import { createHash } from "node:crypto";
import { MatchError } from "./errors.mjs";
import { contractKey } from "./path-normalize.mjs";

/**
 * Default map: config env key → logical_repo that serves that base URL.
 * Extensible via stitch options.
 */
export const DEFAULT_CONFIG_TARGET_REPO = Object.freeze({
  PROVIDERCONTROLLER_API_URL: "tax-provider-controller",
  TAX_PROVIDER_RJ_URL: "tax-provider-rj",
  TAX_PROVIDER_CONTROLLER_URL: "tax-provider-controller",
});

/**
 * @typedef {import("./frontier-extract.mjs").FrontierFact} FrontierFact
 */

/**
 * @typedef {{
 *   edge_id: string,
 *   from: { namespace: string, logical_repo: string, fact_id: string },
 *   to: { namespace: string, logical_repo: string, fact_id: string },
 *   contract_key: string,
 *   method: string,
 *   path: string,
 *   evidence_class: "contract-matched",
 *   match_kind: "config_binding" | "path_contract",
 *   score: number,
 *   config_key?: string,
 *   evidence: object[],
 * }} SystemEdge
 */

/**
 * @param {FrontierFact[]} fromFacts  outbound side (e.g. zul-tax)
 * @param {FrontierFact[]} toFacts    inbound side (e.g. controller)
 * @param {{
 *   system_namespace?: string,
 *   config_target_repo?: Record<string, string>,
 *   min_score?: number,
 * }} [options]
 * @returns {SystemEdge[]}
 */
export function matchFrontiers(fromFacts, toFacts, options = {}) {
  if (!Array.isArray(fromFacts) || !Array.isArray(toFacts)) {
    throw new MatchError("fromFacts and toFacts must be arrays");
  }
  const configMap = {
    ...DEFAULT_CONFIG_TARGET_REPO,
    ...(options.config_target_repo || {}),
  };
  const minScore = options.min_score ?? 0.5;

  const inbounds = toFacts.filter((f) => f.kind === "http_inbound" && f.contract_key);
  const outbounds = fromFacts.filter((f) => f.kind === "http_outbound" && f.contract_key);

  /** @type {Map<string, FrontierFact[]>} */
  const inboundByContract = new Map();
  for (const inn of inbounds) {
    const k = /** @type {string} */ (inn.contract_key);
    if (!inboundByContract.has(k)) inboundByContract.set(k, []);
    inboundByContract.get(k).push(inn);
  }

  /** @type {SystemEdge[]} */
  const edges = [];
  const seen = new Set();

  for (const out of outbounds) {
    const ck = /** @type {string} */ (out.contract_key);
    const candidates = inboundByContract.get(ck) || [];
    for (const inn of candidates) {
      // Prefer same-path matches where config_key maps to target repo
      let score = 0.55; // path contract alone
      let matchKind = /** @type {"config_binding"|"path_contract"} */ ("path_contract");
      if (out.config_key && configMap[out.config_key] === inn.logical_repo) {
        score = 0.95;
        matchKind = "config_binding";
      } else if (out.config_key && configMap[out.config_key]) {
        // config points elsewhere — skip or low score
        if (configMap[out.config_key] !== inn.logical_repo) continue;
      }

      if (score < minScore) continue;
      if (out.logical_repo === inn.logical_repo) continue; // not cross-service

      const edge = buildEdge(out, inn, matchKind, score);
      if (seen.has(edge.edge_id)) continue;
      seen.add(edge.edge_id);
      edges.push(edge);
    }
  }

  return edges.sort((a, b) => b.score - a.score || a.edge_id.localeCompare(b.edge_id));
}

/**
 * @param {FrontierFact} out
 * @param {FrontierFact} inn
 * @param {"config_binding"|"path_contract"} matchKind
 * @param {number} score
 * @returns {SystemEdge}
 */
function buildEdge(out, inn, matchKind, score) {
  const method = out.method || inn.method || "GET";
  const path = out.path || inn.path || "/";
  const ck = out.contract_key || inn.contract_key || contractKey(method, path);
  const material = [
    out.namespace,
    out.logical_repo,
    out.id,
    inn.namespace,
    inn.logical_repo,
    inn.id,
    ck,
    matchKind,
  ].join("|");
  const edge_id = `l1:${createHash("sha256").update(material).digest("hex").slice(0, 32)}`;

  return {
    edge_id,
    from: {
      namespace: out.namespace,
      logical_repo: out.logical_repo,
      fact_id: out.id,
    },
    to: {
      namespace: inn.namespace,
      logical_repo: inn.logical_repo,
      fact_id: inn.id,
    },
    contract_key: ck,
    method,
    path,
    evidence_class: "contract-matched",
    match_kind: matchKind,
    score,
    ...(out.config_key ? { config_key: out.config_key } : {}),
    evidence: [
      {
        side: "from",
        file: out.file,
        line: out.line,
        snippet: out.evidence_snippet,
        revision: out.source_revision,
      },
      {
        side: "to",
        file: inn.file,
        line: inn.line,
        snippet: inn.evidence_snippet,
        revision: inn.source_revision,
      },
    ],
  };
}
