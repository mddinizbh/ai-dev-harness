/**
 * Route matcher — the deterministic core of L1 (cross-service connection).
 *
 * Given a client service's outbound HTTP calls and a server service's exposed
 * endpoints, produces cross-service CALLS edges by joining on METHOD + the
 * NORMALIZED path template (param names collapsed to positional placeholders,
 * so `{category}` on the caller matches `{debitType}` on the callee — the join
 * is by structure, not literal string, per ADR 0004).
 *
 * No store, no LLM, no git. Edges are `contract-matched` (static inference);
 * only a runtime trace promotes them to `runtime-observed`. Calibrated for
 * recall: unmatched outbound calls are surfaced, never silently dropped, and
 * ambiguous matches (one call, N candidate endpoints) emit all candidates
 * flagged, rather than guessing one.
 */

/** Collapse `{param}` segments to `{}` so templates match by structure. */
export function normalizeTemplate(path) {
  return path
    .split("/")
    .map((seg) => (/^\{.*\}$/.test(seg) ? "{}" : seg))
    .join("/");
}

function keyOf(method, path) {
  return `${method.toUpperCase()} ${normalizeTemplate(path)}`;
}

/**
 * @param {object} input
 * @param {Array<{method,path,symbol,provenance}>} input.outboundCalls
 * @param {Array<{method,path,handler,provenance?}>} input.exposedEndpoints
 * @param {string} input.fromNamespace  caller service namespace
 * @param {string} input.toNamespace    callee service namespace
 * @param {string} input.binding        deploy-config binding that anchors the join (e.g. env var name)
 * @returns {{edges: object[], unmatched: object[]}}
 */
export function matchRoutes({
  outboundCalls,
  exposedEndpoints,
  fromNamespace,
  toNamespace,
  binding,
}) {
  if (!Array.isArray(outboundCalls) || !Array.isArray(exposedEndpoints)) {
    throw new TypeError("outboundCalls and exposedEndpoints must be arrays");
  }

  const serverByKey = new Map();
  for (const ep of exposedEndpoints) {
    const k = keyOf(ep.method, ep.path);
    if (!serverByKey.has(k)) serverByKey.set(k, []);
    serverByKey.get(k).push(ep);
  }

  const edges = [];
  const unmatched = [];

  for (const call of outboundCalls) {
    const k = keyOf(call.method, call.path);
    const candidates = serverByKey.get(k);
    if (candidates === undefined || candidates.length === 0) {
      unmatched.push(call);
      continue;
    }
    const ambiguous = candidates.length > 1;
    for (const ep of candidates) {
      edges.push({
        relation_type: "CALLS",
        evidence_class: "contract-matched",
        method: call.method.toUpperCase(),
        route: `${ep.method.toUpperCase()} ${ep.path}`,
        normalized: k,
        from_namespace: fromNamespace,
        to_namespace: toNamespace,
        binding,
        client: { namespace: fromNamespace, symbol: call.symbol, provenance: call.provenance },
        server: { namespace: toNamespace, handler: ep.handler, provenance: ep.provenance ?? null },
        ...(ambiguous ? { ambiguous: true } : {}),
      });
    }
  }

  edges.sort((a, b) => {
    const h = a.server.handler < b.server.handler ? -1 : a.server.handler > b.server.handler ? 1 : 0;
    return h !== 0 ? h : a.method.localeCompare(b.method);
  });
  return { edges, unmatched };
}
