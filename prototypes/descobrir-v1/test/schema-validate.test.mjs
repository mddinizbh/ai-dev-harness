import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Seam under test: zero-dependency validation against the real Descobrir
// JSON Schemas under workflows/descobrir/contracts/. Public API loads schema
// JSON at runtime (source of truth) and returns
// { valid, errors: [{ path, message, schema_id }] }.
import {
  validateKnowledgeRecord,
  validateRelation,
  validateArtifactManifest,
  validateGraphIndex,
  validateCoverageReport,
  SUPPORTED_KEYWORDS,
} from "../src/schema/descobrir.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CONTRACTS = join(here, "..", "..", "..", "workflows", "descobrir", "contracts");

const SHA = "a".repeat(64);
const REV = "633d3a5d16c165073ede2b2248bae708483f2efe";
const MANIFEST_ID = "manifest:nori-load-1";

const KR_ID =
  "https://ai-dev-harness.local/workflows/descobrir/contracts/knowledge-record.schema.json";
const REL_ID =
  "https://ai-dev-harness.local/workflows/descobrir/contracts/relation.schema.json";
const AM_ID =
  "https://ai-dev-harness.local/workflows/descobrir/contracts/artifact-manifest.schema.json";
const GI_ID =
  "https://ai-dev-harness.local/workflows/descobrir/contracts/graph-index.schema.json";
const CR_ID =
  "https://ai-dev-harness.local/workflows/descobrir/contracts/coverage-report.schema.json";

function artifactEvidence(path = ".claude/explorer/endpoints.md") {
  return {
    kind: "artifact",
    manifest_id: MANIFEST_ID,
    artifact_path: path,
    content_sha256: SHA,
    range: { start_line: 1, end_line: 2 },
  };
}

function repositoryEvidence(
  uri = `repo://nori-cloud@${REV}/domains/iam/controller/service_register.go#L60-L60`,
) {
  return { kind: "repository", uri };
}

function sourceEngine() {
  return {
    name: "explorer",
    profile: "api",
    adapter_version: "0.1.0",
    artifact_manifest_id: MANIFEST_ID,
  };
}

function validKnowledgeRecord(overrides = {}) {
  return {
    id: "service:billing",
    namespace: "nori",
    type: "Service",
    name: "Billing",
    summary: "Billing service",
    attributes: { layer: "domain" },
    status: "hipótese",
    source_revision: REV,
    source_engine: sourceEngine(),
    evidence: [artifactEvidence()],
    ...overrides,
  };
}

function validRelation(overrides = {}) {
  return {
    id: "exposes:service:billing:endpoint:get:/billing",
    namespace: "nori",
    from_record: "service:billing",
    relation_type: "EXPOSES",
    to_record: "endpoint:get:/billing",
    status: "hipótese",
    source_revision: REV,
    source_engine: sourceEngine(),
    evidence: [artifactEvidence()],
    ...overrides,
  };
}

function validArtifactManifest(overrides = {}) {
  return {
    id: MANIFEST_ID,
    namespace: "nori",
    logical_repo: "nori-cloud",
    source_revision: REV,
    engine: { name: "explorer", profile: "api" },
    adapter: { version: "0.1.0", name: "explorer-adapter" },
    acquisition_mode: "reused",
    artifacts: [
      {
        path: ".claude/explorer/endpoints.md",
        content_sha256: SHA,
        role: "native",
        declared_revision: REV,
        status: "complete",
      },
    ],
    freshness: { source_revision: REV },
    ...overrides,
  };
}

function validGraphIndex(overrides = {}) {
  return {
    id: "graph-index:1",
    namespace: "nori",
    source_revision: REV,
    artifact_manifest_id: MANIFEST_ID,
    engine: { name: "explorer", profile: "api" },
    record_ids: ["service:billing"],
    relation_ids: ["exposes:service:billing:endpoint:get:/billing"],
    counts: { records: 1, relations: 1 },
    canonical_graph_hash: SHA,
    ...overrides,
  };
}

function validCoverageReport(overrides = {}) {
  return {
    id: "coverage:nori-load-1",
    namespace: "nori",
    source_revision: REV,
    artifact_manifest_id: MANIFEST_ID,
    graph_index_id: "graph-index:1",
    schema_result: { valid: true, errors: [] },
    provenance: {
      total_entities: 0,
      artifact_reference_count: 0,
      artifact_reference_percentage: 0,
      repository_verified_count: 0,
      repository_verified_percentage: 0,
    },
    unresolved_ids: [],
    status_counts: {
      comprovado: 0,
      hipótese: 0,
      contradição: 0,
      stale: 0,
    },
    repeatability: { result: "pass", canonical_graph_hash: SHA },
    freshness: { source_revision: REV },
    producer_baseline: {
      declared_counts: {},
      indexed_counts: {},
      deltas: [],
      result: "pass",
    },
    mutation: {
      pre: { summary_hash: SHA },
      post: { summary_hash: SHA },
      equivalent: true,
    },
    threshold: {
      minimum_repository_verified_percentage: 0,
      require_schema_valid: true,
      require_repeatability_pass: true,
      require_mutation_equivalent: true,
      require_producer_reconciliation_pass: true,
    },
    passed: true,
    ...overrides,
  };
}

function assertResultShape(result) {
  assert.equal(typeof result.valid, "boolean");
  assert.ok(Array.isArray(result.errors));
  for (const err of result.errors) {
    assert.equal(typeof err.path, "string");
    assert.equal(typeof err.message, "string");
    assert.equal(typeof err.schema_id, "string");
    assert.ok(err.message.length > 0);
    // Errors must not echo raw sensitive payloads (absolute paths, secrets).
    assert.equal(err.message.includes("/Users/"), false);
    assert.equal(err.message.includes("password"), false);
  }
}

describe("SUPPORTED_KEYWORDS inventory", () => {
  test("declares exactly the implemented keyword subset", () => {
    const expected = [
      "$ref",
      "type",
      "required",
      "properties",
      "additionalProperties",
      "enum",
      "const",
      "pattern",
      "minLength",
      "minItems",
      "minimum",
      "maximum",
      "items",
      "contains",
      "minContains",
      "propertyNames",
      "oneOf",
      "allOf",
      "if",
      "then",
    ].sort();
    assert.deepStrictEqual([...SUPPORTED_KEYWORDS].sort(), expected);
  });
});

describe("validateKnowledgeRecord against real schema", () => {
  test("accepts a valid hipótese record with artifact evidence only", () => {
    const result = validateKnowledgeRecord(validKnowledgeRecord());
    assertResultShape(result);
    assert.equal(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  test("accepts comprovado when repository evidence is present with artifact", () => {
    const result = validateKnowledgeRecord(
      validKnowledgeRecord({
        status: "comprovado",
        evidence: [artifactEvidence(), repositoryEvidence()],
      }),
    );
    assert.equal(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  test("rejects comprovado without repository evidence (artifact-only)", () => {
    const result = validateKnowledgeRecord(
      validKnowledgeRecord({
        status: "comprovado",
        evidence: [artifactEvidence()],
      }),
    );
    assertResultShape(result);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 1);
    assert.ok(result.errors.every((e) => e.schema_id === KR_ID));
    // if/then contains on evidence must surface a path under /evidence
    assert.ok(result.errors.some((e) => e.path === "/evidence" || e.path.startsWith("/evidence")));
  });

  test("rejects missing required field", () => {
    const rec = validKnowledgeRecord();
    delete rec.summary;
    const result = validateKnowledgeRecord(rec);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "" || e.path === "/summary"));
    assert.ok(result.errors.every((e) => e.schema_id === KR_ID));
  });

  test("rejects additional top-level properties", () => {
    const result = validateKnowledgeRecord(
      validKnowledgeRecord({ extra_secret_field: "nope" }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path.includes("extra_secret_field")));
  });

  test("rejects invalid canonical id pattern", () => {
    const result = validateKnowledgeRecord(validKnowledgeRecord({ id: "nocolon" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "/id"));
  });

  test("rejects empty evidence array (minItems + contains artifact)", () => {
    const result = validateKnowledgeRecord(validKnowledgeRecord({ evidence: [] }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "/evidence"));
  });

  test("rejects evidence without any artifact item (contains kind=artifact)", () => {
    const result = validateKnowledgeRecord(
      validKnowledgeRecord({
        status: "hipótese",
        evidence: [repositoryEvidence()],
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "/evidence"));
  });

  test("rejects malformed repository uri pattern", () => {
    const result = validateKnowledgeRecord(
      validKnowledgeRecord({
        evidence: [
          artifactEvidence(),
          { kind: "repository", uri: "not-a-repo-uri" },
        ],
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path.startsWith("/evidence/")));
  });

  test("rejects unknown status enum value", () => {
    const result = validateKnowledgeRecord(validKnowledgeRecord({ status: "draft" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "/status"));
  });

  test("rejects non-object instance", () => {
    const result = validateKnowledgeRecord("not-an-object");
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 1);
    assert.ok(result.errors.every((e) => e.schema_id === KR_ID));
  });

  test("errors are deterministic for the same invalid instance", () => {
    const bad = validKnowledgeRecord({ id: "bad", status: "draft" });
    const a = validateKnowledgeRecord(bad);
    const b = validateKnowledgeRecord(bad);
    assert.deepStrictEqual(a, b);
  });
});

describe("validateRelation against real schema", () => {
  test("accepts a valid hipótese relation", () => {
    const result = validateRelation(validRelation());
    assert.equal(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  test("rejects comprovado without repository evidence", () => {
    const result = validateRelation(
      validRelation({
        status: "comprovado",
        evidence: [artifactEvidence()],
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.every((e) => e.schema_id === REL_ID));
    assert.ok(result.errors.some((e) => e.path === "/evidence" || e.path.startsWith("/evidence")));
  });

  test("accepts comprovado with repository + artifact evidence", () => {
    const result = validateRelation(
      validRelation({
        status: "comprovado",
        evidence: [artifactEvidence(), repositoryEvidence()],
      }),
    );
    assert.equal(result.valid, true);
  });
});

describe("validateArtifactManifest against real schema", () => {
  test("accepts a valid manifest", () => {
    const result = validateArtifactManifest(validArtifactManifest());
    assert.equal(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  test("rejects invalid acquisition_mode enum", () => {
    const result = validateArtifactManifest(
      validArtifactManifest({ acquisition_mode: "cached" }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "/acquisition_mode"));
    assert.ok(result.errors.every((e) => e.schema_id === AM_ID));
  });

  test("rejects logical_repo with slash", () => {
    const result = validateArtifactManifest(
      validArtifactManifest({ logical_repo: "org/nori-cloud" }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "/logical_repo"));
  });

  test("rejects artifact path that is absolute-style", () => {
    const result = validateArtifactManifest(
      validArtifactManifest({
        artifacts: [
          {
            path: "/tmp/secret.md",
            content_sha256: SHA,
            role: "native",
            declared_revision: REV,
            status: "complete",
          },
        ],
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path.startsWith("/artifacts/")));
    // Must not leak absolute path content into message as a dump
    for (const e of result.errors) {
      assert.equal(e.message.includes("/tmp/secret.md"), false);
    }
  });
});

describe("validateGraphIndex against real schema", () => {
  test("accepts a valid graph index", () => {
    const result = validateGraphIndex(validGraphIndex());
    assert.equal(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  test("rejects bad canonical_graph_hash pattern", () => {
    const result = validateGraphIndex(
      validGraphIndex({ canonical_graph_hash: "not-a-hash" }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "/canonical_graph_hash"));
    assert.ok(result.errors.every((e) => e.schema_id === GI_ID));
  });

  test("rejects negative counts.minimum", () => {
    const result = validateGraphIndex(
      validGraphIndex({ counts: { records: -1, relations: 0 } }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "/counts/records"));
  });
});

describe("validateCoverageReport against real schema", () => {
  test("accepts a valid coverage report", () => {
    const result = validateCoverageReport(validCoverageReport());
    assert.equal(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  test("rejects percentage above maximum 100", () => {
    const result = validateCoverageReport(
      validCoverageReport({
        provenance: {
          total_entities: 1,
          artifact_reference_count: 1,
          artifact_reference_percentage: 101,
          repository_verified_count: 0,
          repository_verified_percentage: 0,
        },
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.path === "/provenance/artifact_reference_percentage"),
    );
    assert.ok(result.errors.every((e) => e.schema_id === CR_ID));
  });

  test("rejects empty propertyNames key in metricCountMap", () => {
    const result = validateCoverageReport(
      validCoverageReport({
        producer_baseline: {
          declared_counts: { "": 1 },
          indexed_counts: {},
          deltas: [
            {
              metric: "x",
              declared: 1,
              indexed: 0,
              delta: -1,
              explanation: "missing",
            },
          ],
          result: "fail",
        },
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.path.startsWith("/producer_baseline/declared_counts")),
    );
  });

  test("rejects delta explanation empty string (minLength)", () => {
    const result = validateCoverageReport(
      validCoverageReport({
        producer_baseline: {
          declared_counts: { endpoints: 1 },
          indexed_counts: { endpoints: 1 },
          deltas: [
            {
              metric: "endpoints",
              declared: 1,
              indexed: 1,
              delta: 0,
              explanation: "",
            },
          ],
          result: "pass",
        },
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) =>
        e.path.includes("/producer_baseline/deltas/") && e.path.endsWith("/explanation"),
      ),
    );
  });
});

describe("runtime schema files are the source of truth", () => {
  test("each contract schema file is readable JSON with matching $id", () => {
    const files = {
      "knowledge-record.schema.json": KR_ID,
      "relation.schema.json": REL_ID,
      "artifact-manifest.schema.json": AM_ID,
      "graph-index.schema.json": GI_ID,
      "coverage-report.schema.json": CR_ID,
    };
    for (const [name, id] of Object.entries(files)) {
      const raw = JSON.parse(readFileSync(join(CONTRACTS, name), "utf8"));
      assert.equal(raw.$id, id);
    }
  });
});
