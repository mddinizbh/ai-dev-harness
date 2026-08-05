/**
 * Bottom-up L2 step 2: enrich L1-proposed journey with L0 anchors.
 * Attaches methods/services from accepted L0 packages near edge evidence files.
 * Emits warnings for hotspots that require reading method BODY (not name).
 * Never invents partner/UF defaults.
 */

/** Method/service name patterns that MUST NOT become domain claims without body read */
const BODY_HOTSPOTS = [
  /choosePartner/i,
  /useController/i,
  /getTaxProvider/i,
  /PartnerHelper/i,
  /ProviderRegistry/i,
  /fetchDebits/i,
  /retrieve(Ipva|Tickets|Licensing|Debits)/i,
  /pay(Ipva|Tickets|Licensing)/i,
];

/**
 * @param {object} spec  JourneySpec from propose-from-l1 (or human)
 * @param {{
 *   packages_by_repo: Record<string, { records: object[], relations?: object[] }>,
 *   max_anchors_per_step?: number,
 * }} opts
 */
export function enrichFromL0(spec, opts) {
  if (!spec?.id || !Array.isArray(spec.steps)) {
    throw new Error("enrichFromL0: invalid JourneySpec");
  }
  const packages = opts?.packages_by_repo || {};
  const maxAnchors = opts?.max_anchors_per_step ?? 12;

  /** @type {object[]} */
  const warnings = [];
  /** @type {object[]} */
  const steps = [];

  for (const step of spec.steps) {
    const evidence = step.provenance?.evidence || [];
    const repos = new Set();
    if (step.from) repos.add(step.from);
    if (step.to) repos.add(step.to);

    /** @type {object[]} */
    const anchors = [];
    /** @type {string[]} */
    const stepWarnings = [];

    for (const repo of repos) {
      const pkg = packages[repo];
      if (!pkg?.records) {
        stepWarnings.push(
          `no_accepted_l0_package:${repo} — cannot anchor this side`,
        );
        continue;
      }

      // Index records by normalized source_file
      const byFile = indexRecordsByFile(pkg.records);

      // Evidence files for this repo
      const files = evidence
        .filter((ev) => ev.logical_repo === repo || !ev.logical_repo)
        .map((ev) => ev.file)
        .filter(Boolean);

      const fileSet = new Set(files.map(normPath));

      // If evidence has side-specific repo, prefer those files only
      const sideFiles = evidence
        .filter((ev) => {
          if (ev.logical_repo) return ev.logical_repo === repo;
          // fallback: file path matching later
          return true;
        })
        .map((ev) => normPath(ev.file))
        .filter(Boolean);

      const targetFiles =
        sideFiles.length > 0 ? new Set(sideFiles) : fileSet;

      for (const fp of targetFiles) {
        const recs = byFile.get(fp) || byFile.get(basename(fp)) || [];
        for (const r of recs) {
          if (r.type !== "Method" && r.type !== "Service") continue;
          anchors.push({
            repo,
            type: r.type,
            name: r.name,
            summary: r.summary,
            source_file: (r.attributes && r.attributes.source_file) || fp,
            focus: r.attributes?.focus,
            status: r.status,
            id: r.id,
          });
        }
      }

      // Also pull hotspot methods in same package path prefixes as evidence files
      for (const fp of targetFiles) {
        const dir = dirOf(fp);
        if (!dir) continue;
        for (const [f, recs] of byFile) {
          if (!f.includes(dir) && !normPath(f).startsWith(dir)) continue;
          for (const r of recs) {
            if (r.type !== "Method" && r.type !== "Service") continue;
            const n = r.name || "";
            if (!BODY_HOTSPOTS.some((re) => re.test(n) || re.test(r.summary || ""))) {
              continue;
            }
            anchors.push({
              repo,
              type: r.type,
              name: r.name,
              summary: r.summary,
              source_file: (r.attributes && r.attributes.source_file) || f,
              focus: r.attributes?.focus,
              status: r.status,
              id: r.id,
              hotspot: true,
            });
          }
        }
      }
    }

    const deduped = dedupeAnchors(anchors).slice(0, maxAnchors);
    const hotspots = deduped.filter((a) =>
      BODY_HOTSPOTS.some((re) => re.test(a.name || "") || re.test(a.summary || "")),
    );

    if (hotspots.length > 0) {
      const names = hotspots
        .slice(0, 5)
        .map((h) => h.name)
        .join(", ");
      stepWarnings.push(
        `Ler body antes de claim de domínio: ${names}` +
          (hotspots.length > 5 ? "…" : "") +
          " (L0 só ancora o nome do método)",
      );
    }

    if (deduped.length === 0 && step.trigger === "http-sync") {
      stepWarnings.push(
        "Sem Method/Service L0 nos arquivos da evidence desta edge",
      );
    }

    for (const w of stepWarnings) {
      warnings.push({ step_id: step.id, warning: w });
    }

    const baseDesc = step.description || "";
    let l0Note = "";
    if (deduped.length) {
      const names = deduped
        .slice(0, 5)
        .map((a) => a.name)
        .join(", ");
      l0Note =
        ` Código próximo (L0): ${names}` +
        (deduped.length > 5 ? "…" : "") +
        ".";
      if (hotspots.length) {
        l0Note +=
          " Atenção: há métodos sensíveis (retrieve/pay/partner) — não inferir regra de negócio só pelo nome.";
      }
    } else {
      l0Note = " Nenhum símbolo L0 achado nos arquivos da evidence.";
    }

    steps.push({
      ...step,
      description: baseDesc + l0Note,
      provenance: {
        ...(step.provenance || {}),
        source:
          step.provenance?.source === "l1"
            ? "l1+l0"
            : step.provenance?.source || "l0",
        l0_anchors: deduped,
        l0_hotspots: hotspots.map((h) => ({
          repo: h.repo,
          name: h.name,
          source_file: h.source_file,
        })),
        warnings: stepWarnings,
      },
    });
  }

  // Pipeline gate summary (process rules — not Estapar-specific claims)
  const claims_blocked = [
    "Não definir partner default só com L1",
    "Não definir regra de placa/canário sem ler body (ex.: useController/choosePartner)",
    "Não assumir que pay e retrieve usam o mesmo hop sem evidência L0 + body",
  ];

  const repoList = Object.keys(packages).sort();
  const journeyDesc =
    (spec.description || "").replace(/\s+$/, "") +
    (repoList.length
      ? ` Símbolos L0 anexados a partir de: ${repoList.join(", ")}.`
      : " Sem packages L0 aceitos para enriquecer.") +
    (warnings.length
      ? ` ${warnings.length} aviso(s) de hotspot/leitura de body.`
      : "");

  const out = {
    ...spec,
    steps,
    description: journeyDesc,
    pipeline: {
      ...(spec.pipeline || {}),
      stage: "enrich-from-l0",
      l0_repos: repoList,
      warning_count: warnings.length,
      claims_blocked_until_body_read: claims_blocked,
    },
    enrichment: {
      warnings,
      claims_blocked_until_body_read: claims_blocked,
    },
  };

  return {
    spec: out,
    warnings,
    stats: {
      steps: steps.length,
      steps_with_anchors: steps.filter((s) => (s.provenance?.l0_anchors || []).length > 0)
        .length,
      hotspot_steps: steps.filter((s) => (s.provenance?.l0_hotspots || []).length > 0)
        .length,
      warning_count: warnings.length,
    },
  };
}

/**
 * @param {(store: object, q: object) => object} exportPackageFn
 * @param {object} store
 * @param {string} namespace
 * @param {string[]} logicalRepos
 */
export function loadAcceptedPackagesWith(exportPackageFn, store, namespace, logicalRepos) {
  /** @type {Record<string, { records: object[], relations: object[] }>} */
  const out = {};
  for (const repo of logicalRepos) {
    try {
      const pkg = exportPackageFn(store, {
        accepted: true,
        namespace,
        logical_repo: repo,
      });
      out[repo] = {
        records: pkg.records || [],
        relations: pkg.relations || [],
      };
    } catch {
      // missing accepted baseline — skip
    }
  }
  return out;
}

/**
 * @param {object[]} records
 * @returns {Map<string, object[]>}
 */
function indexRecordsByFile(records) {
  /** @type {Map<string, object[]>} */
  const map = new Map();
  for (const r of records) {
    const sf = r.attributes?.source_file || extractFileFromEvidence(r);
    if (!sf) continue;
    const n = normPath(sf);
    const b = basename(n);
    if (!map.has(n)) map.set(n, []);
    map.get(n).push(r);
    if (b && b !== n) {
      if (!map.has(b)) map.set(b, []);
      map.get(b).push(r);
    }
  }
  return map;
}

/**
 * @param {object} r
 */
function extractFileFromEvidence(r) {
  const ev = r.evidence;
  if (!Array.isArray(ev)) return "";
  for (const e of ev) {
    if (e.kind === "repository" && typeof e.uri === "string") {
      // repo://logical@rev/path#Lx-Ly
      const m = e.uri.match(/^repo:\/\/[^@]+@[^/]+\/(.+?)(?:#|$)/);
      if (m) return m[1];
    }
  }
  return "";
}

/**
 * @param {string} p
 */
function normPath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

/**
 * @param {string} p
 */
function basename(p) {
  const n = normPath(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

/**
 * @param {string} p
 */
function dirOf(p) {
  const n = normPath(p);
  const i = n.lastIndexOf("/");
  if (i < 0) return "";
  // keep last 2 segments as package hint
  const parts = n.slice(0, i).split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

/**
 * @param {object[]} anchors
 */
function dedupeAnchors(anchors) {
  const seen = new Set();
  const out = [];
  for (const a of anchors) {
    const k = `${a.repo}\0${a.type}\0${a.name}\0${a.source_file}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  // hotspots first
  out.sort((a, b) => Number(!!b.hotspot) - Number(!!a.hotspot));
  return out;
}
