/**
 * Bind a JourneySpec against system edges (fixture or live).
 * Does not invent edges — reports gaps.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

/**
 * @typedef {{
 *   id: string,
 *   system_namespace: string,
 *   members: string[],
 *   steps: {
 *     id: string,
 *     trigger: "http-sync" | "queue" | "cron" | "webhook" | "internal",
 *     from?: string,
 *     to?: string,
 *     contract_prefix?: string,
 *     contract_key?: string,
 *     description?: string,
 *   }[],
 * }} JourneySpec
 */

/**
 * @param {JourneySpec} spec
 * @param {object[]} edges  system edges
 */
export function bindJourney(spec, edges) {
  if (!spec?.id || !spec.system_namespace || !Array.isArray(spec.steps)) {
    throw new Error("invalid JourneySpec");
  }
  const list = Array.isArray(edges) ? edges : [];
  /** @type {object[]} */
  const bound = [];
  /** @type {object[]} */
  const gaps = [];

  for (const step of spec.steps) {
    let matches = list;
    if (step.from) matches = matches.filter((e) => e.from?.logical_repo === step.from);
    if (step.to) matches = matches.filter((e) => e.to?.logical_repo === step.to);
    if (step.contract_key) {
      matches = matches.filter((e) => e.contract_key === step.contract_key);
    } else if (step.contract_prefix) {
      const p = step.contract_prefix;
      matches = matches.filter((e) => String(e.contract_key || "").startsWith(p));
    }

    if (matches.length === 0) {
      gaps.push({
        step_id: step.id,
        reason: "no_matching_edge",
        trigger: step.trigger,
        from: step.from,
        to: step.to,
        contract_prefix: step.contract_prefix,
        contract_key: step.contract_key,
      });
      bound.push({
        step_id: step.id,
        trigger: step.trigger,
        status: "gap",
        edge_ids: [],
      });
    } else {
      bound.push({
        step_id: step.id,
        trigger: step.trigger,
        status: "bound",
        edge_ids: matches.map((e) => e.edge_id),
        edges: matches.map((e) => ({
          edge_id: e.edge_id,
          contract_key: e.contract_key,
          match_kind: e.match_kind,
          score: e.score,
          from: e.from?.logical_repo,
          to: e.to?.logical_repo,
        })),
      });
    }
  }

  const material = JSON.stringify({
    id: spec.id,
    system_namespace: spec.system_namespace,
    bound,
    gaps,
  });
  const journey_hash = createHash("sha256").update(material).digest("hex").slice(0, 32);

  return {
    journey_id: spec.id,
    system_namespace: spec.system_namespace,
    journey_hash,
    members: spec.members || [],
    steps_bound: bound.filter((b) => b.status === "bound").length,
    steps_gap: gaps.length,
    bound,
    gaps,
    status: gaps.length === 0 ? "complete" : "partial",
  };
}

/**
 * @param {string} path
 * @returns {JourneySpec}
 */
export function loadJourneySpec(path) {
  const text = readFileSync(path, "utf8");
  // minimal YAML-ish: only support JSON files for v1 hermetic (and .json)
  if (path.endsWith(".json")) {
    return JSON.parse(text);
  }
  // strip simple YAML by requiring JSON for now; if looks like JSON ok
  const t = text.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  throw new Error("v1 journey spec must be JSON (.json)");
}
