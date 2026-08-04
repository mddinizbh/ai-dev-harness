/**
 * Export FrontierFact[] from an accepted L0 candidate package (or plain package JSON).
 * Deterministic, no git. Used by explorer-l1 stitch --frontier-dir / fixtures.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {{
 *   kind: "http_inbound" | "http_outbound" | "config_binding" | "topic_publish" | "topic_consume",
 *   namespace: string,
 *   logical_repo: string,
 *   source_revision: string,
 *   method?: string,
 *   path?: string,
 *   contract_key?: string,
 *   config_key?: string,
 *   topic?: string,
 *   file: string,
 *   line: number,
 *   evidence_snippet: string,
 *   id: string,
 * }} FrontierFact
 */

/**
 * @param {string} method
 * @param {string} path
 */
function contractKey(method, path) {
  const m = (method || "GET").toUpperCase();
  let p = (path || "/").toLowerCase();
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\{[^}]+\}/g, "{param}").replace(/\$\{[^}]+\}/g, "{param}");
  return `${m} ${p}`;
}

/**
 * Map Explorer semantic types → frontier kinds.
 * @param {object} rec
 * @param {string} namespace
 * @param {string} logical_repo
 * @param {string} source_revision
 * @returns {FrontierFact | null}
 */
function recordToFact(rec, namespace, logical_repo, source_revision) {
  const type = String(rec.type || "");
  const nk = String(rec.natural_key || rec.name || "");
  const attrs = rec.attributes && typeof rec.attributes === "object" ? rec.attributes : {};
  const file = String(attrs.file || attrs.path || "package");
  const line = Number(attrs.line || 0) || 0;
  const snippet = String(rec.summary || nk).slice(0, 200);
  const base = {
    namespace,
    logical_repo,
    source_revision,
    file,
    line,
    evidence_snippet: snippet,
  };

  // Endpoint: natural_key like "get:/api/foo" or attributes.method+path
  if (/endpoint/i.test(type) || /^([a-z]+):\/\//i.test(nk) || /^([a-z]+):\//i.test(nk)) {
    let method = String(attrs.method || "GET");
    let path = String(attrs.path || "");
    const m = nk.match(/^([a-z]+):(\/.*)$/i);
    if (m) {
      method = m[1].toUpperCase();
      path = m[2];
    }
    if (!path) return null;
    const direction = String(attrs.direction || attrs.kind || "inbound").toLowerCase();
    const kind = direction.includes("out") ? "http_outbound" : "http_inbound";
    const ck = contractKey(method, path);
    const id = factId(kind, base, ck);
    return {
      ...base,
      kind,
      method: method.toUpperCase(),
      path: path.toLowerCase().replace(/\{[^}]+\}/g, "{param}"),
      contract_key: ck,
      ...(attrs.config_key ? { config_key: String(attrs.config_key) } : {}),
      id,
    };
  }

  if (/producer|publish/i.test(type) || attrs.topic) {
    const topic = String(attrs.topic || nk);
    if (!topic) return null;
    const id = factId("topic_publish", base, topic);
    return {
      ...base,
      kind: "topic_publish",
      topic,
      ...(attrs.config_key ? { config_key: String(attrs.config_key) } : {}),
      id,
    };
  }

  if (/consumer|listen|subscriber/i.test(type)) {
    const topic = String(attrs.topic || nk);
    if (!topic) return null;
    const id = factId("topic_consume", base, topic);
    return {
      ...base,
      kind: "topic_consume",
      topic,
      id,
    };
  }

  if (/config/i.test(type) && attrs.config_key) {
    const key = String(attrs.config_key);
    const id = factId("config_binding", base, key);
    return { ...base, kind: "config_binding", config_key: key, id };
  }

  return null;
}

/**
 * @param {string} kind
 * @param {object} base
 * @param {string} key
 */
function factId(kind, base, key) {
  const raw = `${base.namespace}|${base.logical_repo}|${base.source_revision}|${kind}|${key}|${base.file}|${base.line}`;
  const h = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `ff:${kind}:${h}`;
}

/**
 * @param {object} packageJson  L0 candidate package
 * @returns {FrontierFact[]}
 */
export function frontierFromPackage(packageJson) {
  if (!packageJson || typeof packageJson !== "object") {
    throw new Error("packageJson required");
  }
  const namespace = String(packageJson.namespace || "");
  const logical_repo = String(packageJson.logical_repo || "");
  const source_revision = String(packageJson.source_revision || "");
  if (!namespace || !logical_repo) {
    throw new Error("package must have namespace and logical_repo");
  }

  /** @type {FrontierFact[]} */
  const facts = [];
  const records = Array.isArray(packageJson.records) ? packageJson.records : [];
  for (const rec of records) {
    const f = recordToFact(rec, namespace, logical_repo, source_revision);
    if (f) facts.push(f);
  }

  // Also allow explicit packageJson.frontier array (fixtures / future export)
  if (Array.isArray(packageJson.frontier)) {
    for (const f of packageJson.frontier) {
      if (f && f.kind && f.id) facts.push(/** @type {FrontierFact} */ (f));
    }
  }

  const byId = new Map();
  for (const f of facts) byId.set(f.id, f);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * @param {string} packagePath
 * @param {string} outDir  writes <logical_repo>.frontier.json
 */
export function exportFrontierFile(packagePath, outDir) {
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  const facts = frontierFromPackage(pkg);
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const out = join(outDir, `${pkg.logical_repo}.frontier.json`);
  const payload = {
    namespace: pkg.namespace,
    logical_repo: pkg.logical_repo,
    source_revision: pkg.source_revision,
    exported_at: new Date().toISOString(),
    fact_count: facts.length,
    facts,
  };
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  return { output: out, fact_count: facts.length, logical_repo: pkg.logical_repo };
}
