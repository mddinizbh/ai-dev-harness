/**
 * Build a context pack: L2? → L1 hops → code pointers (from edge evidence).
 * Hermetic: operates on in-memory edges / journey bind result.
 */

/**
 * @param {{
 *   system_namespace: string,
 *   question?: string,
 *   journey?: object,
 *   edges: object[],
 *   projections?: object[],
 * }} input
 */
export function buildContextPack(input) {
  const edges = Array.isArray(input.edges) ? input.edges : [];
  /** @type {object[]} */
  let hops = [];

  if (input.journey && Array.isArray(input.journey.bound)) {
    for (const step of input.journey.bound) {
      if (step.status !== "bound") {
        hops.push({
          step_id: step.step_id,
          trigger: step.trigger,
          status: "gap",
          edges: [],
        });
        continue;
      }
      const stepEdges = (step.edges || []).map((se) => {
        const full = edges.find((e) => e.edge_id === se.edge_id) || se;
        return summarizeEdge(full);
      });
      hops.push({
        step_id: step.step_id,
        trigger: step.trigger,
        status: "ok",
        edges: stepEdges,
      });
    }
  } else {
    // no journey: all edges as unordered hops (filtered by question keywords lightly)
    let filtered = edges;
    const q = (input.question || "").toLowerCase();
    if (q) {
      const hits = edges.filter((e) =>
        JSON.stringify(e).toLowerCase().includes(q.split(/\s+/)[0] || q),
      );
      if (hits.length) filtered = hits;
    }
    hops = [
      {
        step_id: "all-edges",
        trigger: "http-sync",
        status: "ok",
        edges: filtered.map(summarizeEdge),
      },
    ];
  }

  const code_pointers = [];
  const seen = new Set();
  for (const h of hops) {
    for (const e of h.edges || []) {
      for (const p of e.code_pointers || []) {
        const k = `${p.repo}|${p.file}|${p.line}`;
        if (seen.has(k)) continue;
        seen.add(k);
        code_pointers.push(p);
      }
    }
  }

  return {
    version: 1,
    system_namespace: input.system_namespace,
    question: input.question || null,
    journey_id: input.journey?.journey_id || null,
    journey_status: input.journey?.status || null,
    hop_count: hops.length,
    hops,
    code_pointers,
    projections: input.projections || [],
    generated_at: new Date().toISOString(),
  };
}

/**
 * @param {object} e
 */
function summarizeEdge(e) {
  const evidence = Array.isArray(e.evidence) ? e.evidence : [];
  const code_pointers = evidence.map((ev) => ({
    side: ev.side,
    repo: ev.side === "from" ? e.from?.logical_repo : e.to?.logical_repo,
    file: ev.file,
    line: ev.line,
    revision: ev.revision,
    snippet: ev.snippet,
  }));
  return {
    edge_id: e.edge_id,
    from: e.from?.logical_repo || e.from,
    to: e.to?.logical_repo || e.to,
    contract_key: e.contract_key,
    match_kind: e.match_kind,
    score: e.score,
    config_key: e.config_key,
    code_pointers,
  };
}
