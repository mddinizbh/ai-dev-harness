/**
 * Coverage Report derivation for Descobrir v1
 * (ADR 0002 + ADR 0003 + workflows/descobrir/contracts/coverage-report.schema.json).
 *
 * Pure derivation of a CoverageReport document from:
 *   - Knowledge Records + Relations (entities carrying status + evidence)
 *   - Artifact Manifest (authoritative inventory for artifact evidence validity)
 *   - explicit per-phase evidence inputs (schema_result, repeatability,
 *     mutation, freshness, unresolved_ids, producer metric maps + explanations)
 *   - caller-provided identifiers and gate threshold
 *
 * `passed` is the implementation invariant: it is computed from the threshold
 * implications and the derived provenance.repository_verified_percentage, and
 * is NEVER accepted from the caller. Zero entities yield 0% rates per schema.
 * Deterministic lexicographic ordering is imposed on unresolved_ids and on
 * producer_baseline.deltas (by metric name). No external dependencies.
 */
export class CoverageReportError extends Error {
  constructor(message) {
    super(message);
    this.name = "CoverageReportError";
  }
}

function fail(reason) {
  throw new CoverageReportError(reason);
}

function requireNonEmpty(value, label) {
  if (typeof value !== "string" || value === "") {
    fail(`${label} must be a non-empty string`);
  }
}

const REPO_URI_RE = /^repo:\/\/[^@/\s]+@([^/\s]+)\/.*#L\d+-L\d+$/;

function repoRevisionAtAnchor(uri, sourceRevision) {
  const m = REPO_URI_RE.exec(uri);
  return m !== null && m[1] === sourceRevision;
}

function wellFormedRange(range) {
  return (
    range !== null &&
    typeof range === "object" &&
    Number.isInteger(range.start_line) &&
    Number.isInteger(range.end_line) &&
    range.start_line >= 1 &&
    range.end_line >= 1 &&
    range.end_line >= range.start_line
  );
}

function artifactEvidenceResolves(ev, manifest) {
  if (ev.kind !== "artifact") return false;
  if (ev.manifest_id !== manifest.id) return false;
  const entry = manifest.artifacts.find((a) => a.path === ev.artifact_path);
  if (entry === undefined || entry.content_sha256 !== ev.content_sha256) return false;
  return wellFormedRange(ev.range);
}

function entityHasValidArtifact(entity, manifest) {
  return entity.evidence.some((ev) => artifactEvidenceResolves(ev, manifest));
}

function entityIsRepositoryVerified(entity, sourceRevision) {
  if (entity.status !== "comprovado") return false;
  return entity.evidence.some(
    (ev) => ev.kind === "repository" && repoRevisionAtAnchor(ev.uri, sourceRevision),
  );
}

function entityIsArtifactOnly(entity) {
  return !entity.evidence.some((ev) => ev.kind === "repository");
}

function percent(count, total) {
  return total === 0 ? 0 : (100 * count) / total;
}

function deriveProvenance(records, relations, manifest, sourceRevision) {
  const entities = [...records, ...relations];
  const total = entities.length;
  const artifactReferenceCount = entities.filter((e) => entityHasValidArtifact(e, manifest)).length;
  const repositoryVerifiedCount = entities
    .filter((e) => entityIsRepositoryVerified(e, sourceRevision))
    .length;
  const artifactOnlyCount = entities.filter(entityIsArtifactOnly).length;
  return {
    total_entities: total,
    total_records: records.length,
    total_relations: relations.length,
    artifact_reference_count: artifactReferenceCount,
    artifact_reference_percentage: percent(artifactReferenceCount, total),
    repository_verified_count: repositoryVerifiedCount,
    repository_verified_percentage: percent(repositoryVerifiedCount, total),
    artifact_only_count: artifactOnlyCount,
  };
}

const STATUS_KEYS = ["comprovado", "hipótese", "contradição", "stale"];

function deriveStatusCounts(records, relations) {
  const counts = { comprovado: 0, "hipótese": 0, "contradição": 0, stale: 0 };
  for (const e of [...records, ...relations]) {
    if (STATUS_KEYS.includes(e.status)) counts[e.status] += 1;
  }
  return counts;
}

function deriveProducerBaseline(declaredCounts, indexedCounts, explanations) {
  const declared = declaredCounts ?? {};
  const indexed = indexedCounts ?? {};
  const expl = explanations ?? {};
  const metrics = [...new Set([...Object.keys(declared), ...Object.keys(indexed)])].sort();
  const deltas = metrics.map((metric) => {
    const d = declared[metric] ?? 0;
    const i = indexed[metric] ?? 0;
    return { metric, declared: d, indexed: i, delta: i - d, explanation: expl[metric] ?? "" };
  });
  const result = deltas.every((d) => d.explanation !== "") ? "pass" : "fail";
  return { declared_counts: declared, indexed_counts: indexed, deltas, result };
}

function validateThreshold(threshold) {
  if (threshold === null || typeof threshold !== "object") {
    fail("threshold must be an object");
  }
  const { minimum_repository_verified_percentage, require_schema_valid,
    require_repeatability_pass, require_mutation_equivalent,
    require_producer_reconciliation_pass } = threshold;
  if (typeof minimum_repository_verified_percentage !== "number") {
    fail("threshold.minimum_repository_verified_percentage must be a number");
  }
  for (const [k, v] of [
    ["require_schema_valid", require_schema_valid],
    ["require_repeatability_pass", require_repeatability_pass],
    ["require_mutation_equivalent", require_mutation_equivalent],
    ["require_producer_reconciliation_pass", require_producer_reconciliation_pass],
  ]) {
    if (typeof v !== "boolean") fail(`threshold.${k} must be a boolean`);
  }
}

function validateManifest(manifest, artifactManifestId) {
  if (manifest === null || typeof manifest !== "object") fail("manifest must be an object");
  if (typeof manifest.id !== "string" || manifest.id === "") fail("manifest.id must be a non-empty string");
  if (!Array.isArray(manifest.artifacts)) fail("manifest.artifacts must be an array");
  if (manifest.id !== artifactManifestId) {
    fail("manifest.id must match artifact_manifest_id");
  }
}

function computePassed({ schemaResult, repeatability, mutation, producerBaseline, provenance, threshold }) {
  const schemaOk = threshold.require_schema_valid !== true || schemaResult.valid === true;
  const repeatOk = threshold.require_repeatability_pass !== true || repeatability.result === "pass";
  const mutationOk = threshold.require_mutation_equivalent !== true || mutation.equivalent === true;
  const producerOk =
    threshold.require_producer_reconciliation_pass !== true || producerBaseline.result === "pass";
  const coverageOk =
    provenance.repository_verified_percentage >= threshold.minimum_repository_verified_percentage;
  return schemaOk && repeatOk && mutationOk && producerOk && coverageOk;
}

export function coverageReport({
  id,
  namespace,
  sourceRevision,
  artifactManifestId,
  graphIndexId,
  records,
  relations,
  manifest,
  schemaResult,
  unresolvedIds,
  repeatability,
  mutation,
  threshold,
  producerDeclaredCounts,
  producerIndexedCounts,
  producerExplanations,
  freshness,
}) {
  requireNonEmpty(id, "id");
  requireNonEmpty(namespace, "namespace");
  requireNonEmpty(sourceRevision, "source_revision");
  requireNonEmpty(artifactManifestId, "artifact_manifest_id");
  requireNonEmpty(graphIndexId, "graph_index_id");
  validateManifest(manifest, artifactManifestId);
  validateThreshold(threshold);

  const recordList = records ?? [];
  const relationList = relations ?? [];

  const provenance = deriveProvenance(recordList, relationList, manifest, sourceRevision);
  const statusCounts = deriveStatusCounts(recordList, relationList);
  const producerBaseline = deriveProducerBaseline(
    producerDeclaredCounts,
    producerIndexedCounts,
    producerExplanations,
  );
  const sortedUnresolvedIds = [...(unresolvedIds ?? [])].sort();

  const passed = computePassed({
    schemaResult,
    repeatability,
    mutation,
    producerBaseline,
    provenance,
    threshold,
  });

  return {
    id,
    namespace,
    source_revision: sourceRevision,
    artifact_manifest_id: artifactManifestId,
    graph_index_id: graphIndexId,
    schema_result: schemaResult,
    provenance,
    unresolved_ids: sortedUnresolvedIds,
    status_counts: statusCounts,
    repeatability,
    freshness: { ...freshness, source_revision: sourceRevision },
    producer_baseline: producerBaseline,
    mutation,
    threshold,
    passed,
  };
}
