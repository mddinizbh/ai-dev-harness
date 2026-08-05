/**
 * Bottom-up L2 step 1: propose JourneySpec skeleton from L1 system edges only.
 * Does NOT invent domain narrative (partner defaults, plate rules, etc.).
 */

/**
 * @typedef {import("./journey-bind.mjs").JourneySpec} JourneySpec
 */

/**
 * @param {object[]} edges
 * @param {{
 *   system_namespace: string,
 *   journey_id?: string,
 *   from_repo?: string,
 *   to_repo?: string,
 *   min_score?: number,
 *   group_by?: "edge" | "contract_prefix",
 * }} opts
 */
export function proposeFromL1(edges, opts) {
  if (!opts?.system_namespace) {
    throw new Error("proposeFromL1: system_namespace required");
  }
  if (!Array.isArray(edges)) {
    throw new Error("proposeFromL1: edges must be an array");
  }

  const minScore = typeof opts.min_score === "number" ? opts.min_score : 0.0;
  let list = edges.filter((e) => (e.score ?? 0) >= minScore);
  if (opts.from_repo) {
    list = list.filter((e) => e.from?.logical_repo === opts.from_repo);
  }
  if (opts.to_repo) {
    list = list.filter((e) => e.to?.logical_repo === opts.to_repo);
  }

  // Stable sort
  list = [...list].sort((a, b) => {
    const ak = `${a.from?.logical_repo || ""}\0${a.to?.logical_repo || ""}\0${a.contract_key || ""}`;
    const bk = `${b.from?.logical_repo || ""}\0${b.to?.logical_repo || ""}\0${b.contract_key || ""}`;
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });

  const members = new Set();
  for (const e of list) {
    if (e.from?.logical_repo) members.add(e.from.logical_repo);
    if (e.to?.logical_repo) members.add(e.to.logical_repo);
  }

  const groupBy = opts.group_by || "contract_prefix";
  /** @type {Map<string, object[]>} */
  const groups = new Map();

  for (const e of list) {
    const from = e.from?.logical_repo || "unknown";
    const to = e.to?.logical_repo || "unknown";
    let gkey;
    if (groupBy === "edge") {
      gkey = e.edge_id || `${from}->${to}:${e.contract_key}`;
    } else {
      // contract_prefix: method + first 2 path segments after empty
      const prefix = contractPrefix(e.method, e.path || e.contract_key);
      gkey = `${from}->${to}::${prefix}`;
    }
    if (!groups.has(gkey)) groups.set(gkey, []);
    groups.get(gkey).push(e);
  }

  const steps = [];
  let i = 0;
  for (const [gkey, groupEdges] of groups) {
    i += 1;
    const head = groupEdges[0];
    const from = head.from?.logical_repo;
    const to = head.to?.logical_repo;
    const prefix = contractPrefix(head.method, head.path || head.contract_key);
    const scores = groupEdges.map((e) => e.score ?? 0);
    const minS = Math.min(...scores);
    const maxS = Math.max(...scores);
    const stepId = slugStep(from, to, prefix, i);

    steps.push({
      id: stepId,
      trigger: "http-sync",
      from,
      to,
      contract_prefix: prefix,
      description:
        `L1-proposed hop ${from} → ${to} (${prefix}). ` +
        `${groupEdges.length} edge(s), score ${minS === maxS ? maxS : `${minS}-${maxS}`}. ` +
        `Domain semantics NOT inferred — enrich-from-l0 required.`,
      provenance: {
        source: "l1",
        edge_ids: groupEdges.map((e) => e.edge_id).filter(Boolean),
        match_kinds: [...new Set(groupEdges.map((e) => e.match_kind).filter(Boolean))],
        config_keys: [
          ...new Set(groupEdges.map((e) => e.config_key).filter(Boolean)),
        ],
        evidence: flattenEvidence(groupEdges),
      },
    });
  }

  const pairBit =
    opts.from_repo && opts.to_repo
      ? `${opts.from_repo}--${opts.to_repo}`
      : opts.from_repo
        ? `from-${opts.from_repo}`
        : opts.to_repo
          ? `to-${opts.to_repo}`
          : "all";
  const journeyId =
    opts.journey_id ||
    `journey-l1-${slug(opts.system_namespace)}-${slug(pairBit)}`;

  /** @type {JourneySpec & { pipeline?: object }} */
  const spec = {
    id: journeyId,
    system_namespace: opts.system_namespace,
    members: [...members].sort(),
    description:
      `Auto-proposed from L1 system_edges only (${list.length} edges → ${steps.length} steps). ` +
      `Bottom-up pipeline: propose-from-l1 → enrich-from-l0 → bind. ` +
      `Do NOT treat as domain truth until L0 enrichment.`,
    steps,
    pipeline: {
      stage: "propose-from-l1",
      edge_count: list.length,
      step_count: steps.length,
      min_score: minScore,
      group_by: groupBy,
      filters: {
        from_repo: opts.from_repo || null,
        to_repo: opts.to_repo || null,
      },
    },
  };

  return {
    spec,
    stats: {
      input_edges: edges.length,
      filtered_edges: list.length,
      steps: steps.length,
      members: spec.members,
    },
  };
}

/**
 * @param {string|undefined} method
 * @param {string|undefined} pathOrContract
 */
export function contractPrefix(method, pathOrContract) {
  const raw = pathOrContract || "";
  // contract_key often "GET /path"
  let path = raw;
  let m = method || "";
  const sp = raw.indexOf(" ");
  if (sp > 0 && /^[A-Z]+$/.test(raw.slice(0, sp))) {
    m = raw.slice(0, sp);
    path = raw.slice(sp + 1);
  }
  const parts = path.split("/").filter(Boolean);
  const keep = parts.slice(0, Math.min(3, parts.length));
  const pref = "/" + keep.join("/");
  return m ? `${m} ${pref}` : pref;
}

/**
 * @param {object[]} edges
 */
function flattenEvidence(edges) {
  /** @type {object[]} */
  const out = [];
  for (const e of edges) {
    for (const ev of e.evidence || []) {
      out.push({
        edge_id: e.edge_id,
        side: ev.side,
        file: ev.file,
        line: ev.line,
        snippet: ev.snippet,
        logical_repo:
          ev.side === "from"
            ? e.from?.logical_repo
            : ev.side === "to"
              ? e.to?.logical_repo
              : undefined,
      });
    }
  }
  return out;
}

/**
 * @param {string} s
 */
function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/**
 * @param {string|undefined} from
 * @param {string|undefined} to
 * @param {string} prefix
 * @param {number} i
 */
function slugStep(from, to, prefix, i) {
  const p = slug(prefix.replace(/\//g, "-"));
  return `l1-${slug(from || "x")}--${slug(to || "y")}--${p || "hop"}-${String(i).padStart(2, "0")}`;
}
