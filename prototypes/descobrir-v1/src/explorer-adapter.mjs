/**
 * Explorer Artifact Adapter — public seam for Descobrir v1 (ADR 0002).
 *
 * Converts Explorer native artifacts into Knowledge Records + Relations.
 * Artifact-only (or unverified repo refs) → status hipótese. No live git.
 */
import { indexArtifacts, sortById } from "./explorer/common.mjs";
import { parseEndpoints } from "./explorer/endpoints.mjs";
import { parseFlows } from "./explorer/flow.mjs";
import { parseMessaging } from "./explorer/messaging.mjs";
import { parseDatabase } from "./explorer/database.mjs";
import { parseDeclaredCounts, ADAPTER_PROFILE } from "./explorer/meta.mjs";

/**
 * @param {object} input
 * @param {string} input.namespace
 * @param {string} input.logicalRepo
 * @param {string} input.sourceRevision
 * @param {string} input.engineName
 * @param {string} input.engineProfile
 * @param {string} input.adapterVersion
 * @param {string} input.manifestId
 * @param {Array<{path: string, content: string, contentSha256: string}>} input.artifacts
 */
export function adaptExplorer({
  namespace,
  logicalRepo,
  sourceRevision,
  engineName,
  engineProfile,
  adapterVersion,
  manifestId,
  artifacts,
}) {
  if (!Array.isArray(artifacts)) {
    throw new TypeError("artifacts must be an array");
  }

  const ctx = {
    namespace,
    logicalRepo,
    sourceRevision,
    engineName,
    engineProfile,
    adapterVersion,
    manifestId,
  };

  const byPath = indexArtifacts(artifacts);
  const records = [];
  const relations = [];

  const endpoints = parseEndpoints(ctx, byPath);
  records.push(...endpoints.records);
  relations.push(...endpoints.relations);

  const flows = parseFlows(ctx, byPath);
  records.push(...flows.records);
  relations.push(...flows.relations);

  const messaging = parseMessaging(ctx, byPath);
  records.push(...messaging.records);
  relations.push(...messaging.relations);

  const database = parseDatabase(ctx, byPath);
  records.push(...database.records);
  relations.push(...database.relations);

  // Dedupe records by id (first wins; later evidence merged)
  const recordMap = new Map();
  for (const rec of records) {
    if (!recordMap.has(rec.id)) {
      recordMap.set(rec.id, rec);
    } else {
      const existing = recordMap.get(rec.id);
      existing.evidence.push(...rec.evidence);
    }
  }

  const declaredCounts = parseDeclaredCounts(byPath) ?? {
    endpoints: 0,
    consumers: 0,
    producers: 0,
    flows: 0,
    insights: 0,
  };

  return {
    records: sortById([...recordMap.values()]),
    relations: sortById(relations),
    declaredCounts,
    adapterProfile: ADAPTER_PROFILE,
  };
}
