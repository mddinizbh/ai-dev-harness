import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class OutputConfinementError extends Error {
  constructor(message) {
    super(message);
    this.name = "OutputConfinementError";
  }
}

const RECORD_FIELDS = [
  "id",
  "namespace",
  "type",
  "name",
  "attributes",
  "status",
  "source_revision",
  "source_engine",
  "evidence",
];

const RELATION_FIELDS = [
  "id",
  "namespace",
  "from_record",
  "relation_type",
  "to_record",
  "status",
  "source_revision",
  "source_engine",
  "evidence",
];

function project(value, fields) {
  return Object.fromEntries(
    fields.filter((field) => value[field] !== undefined).map((field) => [field, value[field]]),
  );
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function byId(left, right) {
  return left.id.localeCompare(right.id);
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalGraphHash({ records, relations }) {
  const graph = {
    records: records.map((record) => project(record, RECORD_FIELDS)).sort(byId),
    relations: relations.map((relation) => project(relation, RELATION_FIELDS)).sort(byId),
  };
  const canonicalJson = JSON.stringify(stableValue(graph));
  return sha256(canonicalJson);
}

export function createArtifactManifest({
  namespace,
  logicalRepo,
  sourceRevision,
  engine,
  adapter,
  acquisitionMode,
  artifacts,
  freshness,
}) {
  const identity = {
    namespace,
    logical_repo: logicalRepo,
    source_revision: sourceRevision,
    engine,
    artifact_content_sha256: artifacts.map(({ content_sha256 }) => content_sha256).sort(),
  };

  return {
    id: `manifest:${sha256(JSON.stringify(stableValue(identity)))}`,
    namespace,
    logical_repo: logicalRepo,
    source_revision: sourceRevision,
    engine,
    adapter,
    acquisition_mode: acquisitionMode,
    artifacts: [...artifacts].sort((left, right) => left.path.localeCompare(right.path)),
    freshness,
  };
}

export function createGraphIndex({
  namespace,
  sourceRevision,
  artifactManifestId,
  engine,
  graph,
  metadata,
}) {
  const canonicalGraphDigest = canonicalGraphHash(graph);
  const index = {
    id: `graph-index:${canonicalGraphDigest}`,
    namespace,
    source_revision: sourceRevision,
    artifact_manifest_id: artifactManifestId,
    engine,
    record_ids: graph.records.map(({ id }) => id).sort(),
    relation_ids: graph.relations.map(({ id }) => id).sort(),
    counts: {
      records: graph.records.length,
      relations: graph.relations.length,
    },
    canonical_graph_hash: canonicalGraphDigest,
  };

  return metadata === undefined ? index : { ...index, metadata };
}

function jsonDocument(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function confinedOutputRoot(prototypeRoot) {
  const realPrototypeRoot = realpathSync(prototypeRoot);
  const outputRoot = join(prototypeRoot, "output");

  if (existsSync(outputRoot) && lstatSync(outputRoot).isSymbolicLink()) {
    throw new OutputConfinementError("Output directory must not be a symbolic link");
  }

  mkdirSync(outputRoot, { recursive: true });
  const realOutputRoot = realpathSync(outputRoot);
  if (realOutputRoot !== join(realPrototypeRoot, "output")) {
    throw new OutputConfinementError("Output directory escapes the prototype root");
  }
  return realOutputRoot;
}

export function persistGraphOutput({
  prototypeRoot,
  manifest,
  coverageReport,
  records,
  relations,
  graphIndex,
  adapterProfile,
}) {
  const outputRoot = confinedOutputRoot(prototypeRoot);

  const documents = {
    "adapter-profile.json": adapterProfile,
    "artifact-manifest.json": manifest,
    "coverage-report.json": coverageReport,
    "graph-index.json": graphIndex,
    "knowledge-records.json": [...records].sort(byId),
    "relations.json": [...relations].sort(byId),
  };

  for (const [name, value] of Object.entries(documents)) {
    writeFileSync(join(outputRoot, name), jsonDocument(value), { encoding: "utf8", mode: 0o600 });
  }
}
