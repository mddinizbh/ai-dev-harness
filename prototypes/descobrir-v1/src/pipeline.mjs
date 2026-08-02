/** Descobrir v1 pipeline: acquire → dual adapt/verify → graph → schema → mutation → coverage → persist. */
import { resolve } from "node:path";
import { acquireArtifacts as defaultAcquire } from "./artifact-source.mjs";
import { adaptExplorer } from "./explorer-adapter.mjs";
import {
  createArtifactManifest,
  createGraphIndex,
  persistGraphOutput as defaultPersist,
} from "./graph-persistence.mjs";
import { coverageReport } from "./coverage-report.mjs";
import { mutationEvidence } from "./mutation.mjs";
import { repeatabilityResult } from "./repeatability.mjs";
import { verifyAndPromote } from "./repo-verifier.mjs";
import {
  readFileAtRevision as defaultRead,
  repositorySnapshot as defaultSnapshot,
} from "./git-source.mjs";
import {
  validateArtifactManifest,
  validateCoverageReport,
  validateGraphIndex,
  validateKnowledgeRecord,
  validateRelation,
} from "./schema/descobrir.mjs";

export class PipelineError extends Error {
  constructor(message) {
    super(message);
    this.name = "PipelineError";
  }
}

const ADAPTER = Object.freeze({ name: "explorer-adapter", version: "0.1.0" });
const METRICS = Object.freeze(["endpoints", "flows", "consumers", "producers", "insights"]);

function fail(msg) {
  throw new PipelineError(msg);
}

function productionDependencies(config) {
  const cwd = config.resolver[config.logical_repo];
  return {
    acquireArtifacts: defaultAcquire,
    repositorySnapshot: ({ anchorRevision }) => defaultSnapshot({ cwd, anchorRevision }),
    readFileAtRevision: ({ revision, path }) => defaultRead({ cwd, revision, path }),
    persistGraphOutput: defaultPersist,
  };
}

function sanitizeArtifact(a) {
  const e = {
    path: a.path,
    content_sha256: a.content_sha256 ?? a.contentSha256,
    role: a.role ?? "native",
    declared_revision: a.declared_revision ?? a.declaredRevision,
    status: a.status ?? "complete",
  };
  const bl = a.byte_length ?? a.byteLength;
  if (bl !== undefined) e.byte_length = bl;
  return e;
}

function runIndex(config, artifacts, manifestId, readAtRevision) {
  const adapted = adaptExplorer({
    namespace: config.namespace,
    logicalRepo: config.logical_repo,
    sourceRevision: config.source_revision,
    engineName: config.engine.name,
    engineProfile: config.engine.profile,
    adapterVersion: ADAPTER.version,
    manifestId,
    artifacts: artifacts.map((a) => ({
      path: a.path,
      content: a.content,
      contentSha256: a.contentSha256 ?? a.content_sha256,
    })),
  });
  const verified = verifyAndPromote({
    records: adapted.records,
    relations: adapted.relations,
    logicalRepo: config.logical_repo,
    sourceRevision: config.source_revision,
    readAtRevision,
  });
  return {
    records: verified.records,
    relations: verified.relations,
    unresolvedIds: verified.unresolvedIds,
    declaredCounts: adapted.declaredCounts,
    adapterProfile: adapted.adapterProfile,
  };
}

function indexedCounts(records, relations) {
  return {
    endpoints: records.filter((r) => r.type === "Endpoint").length,
    flows: records.filter((r) => r.type === "Flow").length,
    consumers: relations.filter((r) => r.relation_type === "CONSUMES").length,
    producers: relations.filter((r) => r.relation_type === "PUBLISHES").length,
    insights: 0,
  };
}

function producerExplanations(declared, indexed) {
  const out = {};
  for (const m of METRICS) {
    const d = declared[m] ?? 0;
    const i = indexed[m] ?? 0;
    out[m] = d === i ? "exact match" : `declared ${d}, indexed ${i} (delta ${i - d})`;
  }
  return out;
}

function prefixErrors(prefix, result) {
  return result.errors.map((e) => ({
    path: `${prefix}${e.path === "" ? "" : e.path.startsWith("/") ? e.path : `/${e.path}`}`,
    message: e.message,
    ...(e.schema_id ? { schema_id: e.schema_id } : {}),
  }));
}

function sortErrors(errors) {
  return [...errors].sort((a, b) => {
    const p = a.path.localeCompare(b.path);
    return p !== 0 ? p : a.message.localeCompare(b.message);
  });
}

function schemaResultForGraph(manifest, records, relations, graphIndex) {
  const errors = sortErrors([
    ...prefixErrors("manifest", validateArtifactManifest(manifest)),
    ...records.flatMap((r, i) => prefixErrors(`records/${i}`, validateKnowledgeRecord(r))),
    ...relations.flatMap((r, i) => prefixErrors(`relations/${i}`, validateRelation(r))),
    ...prefixErrors("graph_index", validateGraphIndex(graphIndex)),
  ]);
  return { valid: errors.length === 0, errors };
}

function makeGraphIndex(config, engine, manifestId, graph) {
  return createGraphIndex({
    namespace: config.namespace,
    sourceRevision: config.source_revision,
    artifactManifestId: manifestId,
    engine,
    graph,
  });
}

/** @param {{config:object,prototypeRoot:string,dependencies?:object,observedAt?:string}} input */
export function runDescobrir({ config, prototypeRoot, dependencies, observedAt }) {
  if (config === null || typeof config !== "object") fail("config is required");
  if (typeof prototypeRoot !== "string" || prototypeRoot === "") fail("prototypeRoot is required");
  const expectedOutput = resolve(prototypeRoot, "output");
  if (config.output !== expectedOutput) fail(`config.output must equal ${expectedOutput}`);

  const deps = dependencies ?? productionDependencies(config);
  const targetRoot = config.resolver[config.logical_repo];
  const engine = { name: config.engine.name, profile: config.engine.profile };
  const freshness = {
    source_revision: config.source_revision,
    ...(observedAt !== undefined ? { observed_at: observedAt } : {}),
  };

  const pre = deps.repositorySnapshot({ cwd: targetRoot, anchorRevision: config.source_revision });
  const rawArtifacts = deps.acquireArtifacts({
    repoRoot: targetRoot,
    engineRoot: config.engine.root,
    declaredRevision: config.source_revision,
  });
  const manifest = createArtifactManifest({
    namespace: config.namespace,
    logicalRepo: config.logical_repo,
    sourceRevision: config.source_revision,
    engine,
    adapter: { ...ADAPTER },
    acquisitionMode: "reused",
    artifacts: rawArtifacts.map(sanitizeArtifact),
    freshness,
  });

  const reader = deps.readFileAtRevision;
  const primary = runIndex(config, rawArtifacts, manifest.id, reader);
  const baseline = runIndex(config, rawArtifacts, manifest.id, reader);
  const graphPrimary = { records: primary.records, relations: primary.relations };
  const graphIndex = makeGraphIndex(config, engine, manifest.id, graphPrimary);
  const graphIndexB = makeGraphIndex(config, engine, manifest.id, {
    records: baseline.records,
    relations: baseline.relations,
  });
  const repeatability = repeatabilityResult(
    graphIndex.canonical_graph_hash,
    graphIndexB.canonical_graph_hash,
  );
  const post = deps.repositorySnapshot({ cwd: targetRoot, anchorRevision: config.source_revision });
  const mutation = mutationEvidence(pre, post);
  const declared = primary.declaredCounts ?? {};
  const indexed = indexedCounts(primary.records, primary.relations);

  let schemaResult = schemaResultForGraph(manifest, primary.records, primary.relations, graphIndex);
  const reportArgs = {
    id: `coverage:${graphIndex.canonical_graph_hash}`,
    namespace: config.namespace,
    sourceRevision: config.source_revision,
    artifactManifestId: manifest.id,
    graphIndexId: graphIndex.id,
    records: primary.records,
    relations: primary.relations,
    manifest,
    unresolvedIds: primary.unresolvedIds,
    repeatability,
    mutation,
    threshold: config.threshold,
    producerDeclaredCounts: declared,
    producerIndexedCounts: indexed,
    producerExplanations: producerExplanations(declared, indexed),
    freshness,
  };
  let report = coverageReport({ ...reportArgs, schemaResult });
  const covVal = validateCoverageReport(report);
  if (!covVal.valid) {
    schemaResult = {
      valid: false,
      errors: sortErrors([...schemaResult.errors, ...prefixErrors("coverage_report", covVal)]),
    };
    report = coverageReport({ ...reportArgs, schemaResult });
  }

  deps.persistGraphOutput({
    prototypeRoot,
    manifest,
    coverageReport: report,
    records: primary.records,
    relations: primary.relations,
    graphIndex,
    adapterProfile: primary.adapterProfile,
  });
  return {
    manifest,
    records: primary.records,
    relations: primary.relations,
    graphIndex,
    coverageReport: report,
    adapterProfile: primary.adapterProfile,
  };
}
