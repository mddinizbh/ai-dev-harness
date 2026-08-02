/**
 * Macro-flow chainer — the deterministic core of L2.
 *
 * Given L1 CALLS edges plus each side's flow membership (client symbol → flow;
 * server handler → flow via the TRIGGERS relation), chains micro-flows into
 * macro-flows that cross services: the client flow that reaches the outbound
 * call is linked to the server flow the target endpoint triggers. This is
 * static distributed-trace reconstruction (ADR 0004) — the edge is the seam.
 *
 * No store, no LLM. Chains are `contract-matched` (inference over L1, itself
 * inference) — hipótese² until a runtime trace confirms. Fan-out (one endpoint
 * triggering N flows) yields N branches → a DAG, flagged `branch`. Edges that
 * cannot be chained are surfaced (recall), never silently dropped.
 */

/** Normalize a `flow` or `[flow, ...]` value to an array. */
function asFlows(value) {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

/**
 * @param {object} input
 * @param {object[]} input.edges                 L1 CALLS edges (from route-matcher)
 * @param {Record<string,string>} input.clientSymbolToFlow   caller symbol → flow id
 * @param {Record<string,string|string[]>} input.serverHandlerToFlow  callee handler → flow id(s)
 * @returns {{chains: object[], unresolved: {edge: object, reason: string}[]}}
 */
export function chainMacroFlows({ edges, clientSymbolToFlow, serverHandlerToFlow }) {
  if (!Array.isArray(edges)) {
    throw new TypeError("edges must be an array");
  }
  const symbolMap = new Map(Object.entries(clientSymbolToFlow ?? {}));
  const handlerMap = new Map(
    Object.entries(serverHandlerToFlow ?? {}).map(([k, v]) => [k, asFlows(v)]),
  );

  const chains = [];
  const unresolved = [];

  for (const edge of edges) {
    const fromFlow = symbolMap.get(edge.client?.symbol);
    if (fromFlow === undefined) {
      unresolved.push({ edge, reason: "client-symbol-not-in-any-flow" });
      continue;
    }
    const toFlows = handlerMap.get(edge.server?.handler);
    if (toFlows === undefined || toFlows.length === 0) {
      unresolved.push({ edge, reason: "server-handler-triggers-no-flow" });
      continue;
    }
    const branch = toFlows.length > 1;
    for (const toFlow of toFlows) {
      chains.push({
        from_flow: { namespace: edge.from_namespace, id: fromFlow },
        to_flow: { namespace: edge.to_namespace, id: toFlow },
        via: { route: edge.route, binding: edge.binding },
        evidence_class: "contract-matched",
        ...(branch ? { branch: true } : {}),
      });
    }
  }

  chains.sort((a, b) => {
    const f = a.from_flow.id.localeCompare(b.from_flow.id);
    return f !== 0 ? f : a.to_flow.id.localeCompare(b.to_flow.id);
  });
  return { chains, unresolved };
}
