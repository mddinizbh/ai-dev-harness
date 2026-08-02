import { describe, test } from "node:test";
import assert from "node:assert/strict";

// Seam under test (pre-agreed, ADR 0002 + ADR 0003 +
// coverage-report.schema.json): pure derivation of a CoverageReport document
// from Knowledge Records + Relations + Artifact Manifest, plus explicit
// per-phase evidence (schema_result, repeatability, mutation, freshness,
// unresolved_ids, producer metric maps + explanations).
//
// `passed` is the implementation invariant — the module computes it from the
// threshold implications and derived repository_verified_percentage; it is
// never accepted from the caller. Zero entities yield 0% rates per schema.
//
// Module does not exist yet — this import MUST fail first (RED), then pass.
import { coverageReport, CoverageReportError } from "../src/coverage-report.mjs";

const SHA = "a".repeat(64);
const MANIFEST_ID = "manifest:nori-cloud-load-1";
const REV = "633d3a5d16c165073ede2b2248bae708483f2efe";
const OTHER_REV = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

function repoUri(rev, path = "domains/iam/controller/service_register.go", start = 60, end = 60) {
  return `repo://nori-cloud@${rev}/${path}#L${start}-L${end}`;
}

function validArtifact(path = ".claude/explorer/producers.md") {
  return {
    kind: "artifact",
    manifest_id: MANIFEST_ID,
    artifact_path: path,
    content_sha256: SHA,
    range: { start_line: 10, end_line: 20 },
  };
}

// Record and Relation share the same derivation shape (status + evidence); the
// module never inspects record-only/relation-only fields for provenance, so a
// single builder covers both. Both must carry artifact evidence per schema.
function entity({ id, status, artifact, repo }) {
  const evidence = [artifact ?? validArtifact()];
  if (repo !== undefined) evidence.push({ kind: "repository", uri: repo });
  return { id, status, evidence };
}

function manifest() {
  return {
    id: MANIFEST_ID,
    artifacts: [
      { path: ".claude/explorer/producers.md", content_sha256: SHA },
      { path: ".claude/explorer/endpoints.md", content_sha256: SHA },
    ],
  };
}

function baseArgs(overrides = {}) {
  return {
    id: "coverage:nori-load-1",
    namespace: "nori",
    sourceRevision: REV,
    artifactManifestId: MANIFEST_ID,
    graphIndexId: "graph:nori:load-1",
    records: [],
    relations: [],
    manifest: manifest(),
    schemaResult: { valid: true, errors: [] },
    unresolvedIds: [],
    repeatability: { result: "pass", canonical_graph_hash: SHA },
    mutation: { pre: { summary_hash: SHA }, post: { summary_hash: SHA }, equivalent: true },
    threshold: {
      minimum_repository_verified_percentage: 0,
      require_schema_valid: false,
      require_repeatability_pass: false,
      require_mutation_equivalent: false,
      require_producer_reconciliation_pass: false,
    },
    producerDeclaredCounts: {},
    producerIndexedCounts: {},
    producerExplanations: {},
    freshness: {},
    ...overrides,
  };
}

describe("CoverageReport shape matches coverage-report.schema.json required fields", () => {
  const report = coverageReport(baseArgs());
  const REQUIRED = [
    "id",
    "namespace",
    "source_revision",
    "artifact_manifest_id",
    "graph_index_id",
    "schema_result",
    "provenance",
    "unresolved_ids",
    "status_counts",
    "repeatability",
    "freshness",
    "producer_baseline",
    "mutation",
    "threshold",
    "passed",
  ];

  test("contains every required top-level field", () => {
    for (const key of REQUIRED) {
      assert.ok(key in report, `missing required field: ${key}`);
    }
  });

  test("passed is a boolean computed by the module (not accepted from caller)", () => {
    assert.strictEqual(typeof report.passed, "boolean");
  });

  test("freshness echoes the load source_revision", () => {
    assert.strictEqual(report.freshness.source_revision, REV);
  });

  test("freshness forwards observed_at and stale_record_ids when provided", () => {
    const r = coverageReport(
      baseArgs({
        freshness: { observed_at: "2026-08-02T00:00:00Z", stale_record_ids: ["record:stale:1"] },
      }),
    );
    assert.strictEqual(r.freshness.observed_at, "2026-08-02T00:00:00Z");
    assert.deepStrictEqual(r.freshness.stale_record_ids, ["record:stale:1"]);
  });
});

describe("(a) provenance counts/percentages and status histogram derived from records + relations + manifest", () => {
  const records = [
    entity({ id: "service:iam", status: "comprovado", repo: repoUri(REV) }),
    entity({ id: "event:iam/register", status: "hipótese" }),
    entity({ id: "claim:iam/conflict", status: "contradição", repo: repoUri(REV) }),
  ];
  const relations = [
    entity({
      id: "publishes:service:iam->event:iam/register",
      status: "comprovado",
      repo: repoUri(REV),
    }),
  ];
  const report = coverageReport(baseArgs({ records, relations }));

  test("total_entities is records + relations with the optional breakdown", () => {
    assert.strictEqual(report.provenance.total_entities, 4);
    assert.strictEqual(report.provenance.total_records, 3);
    assert.strictEqual(report.provenance.total_relations, 1);
  });

  test("artifact_reference_count/percentage reflect valid artifact evidence across all entities", () => {
    assert.strictEqual(report.provenance.artifact_reference_count, 4);
    assert.strictEqual(report.provenance.artifact_reference_percentage, 100);
  });

  test("repository_verified_count/percentage count only comprovado entities with repository evidence at the pinned revision", () => {
    assert.strictEqual(report.provenance.repository_verified_count, 2);
    assert.strictEqual(report.provenance.repository_verified_percentage, 50);
  });

  test("artifact_only_count counts entities whose evidence has no repository item", () => {
    assert.strictEqual(report.provenance.artifact_only_count, 1);
  });

  test("status_counts histogram counts every entity status across records and relations", () => {
    assert.deepStrictEqual(report.status_counts, {
      comprovado: 2,
      "hipótese": 1,
      "contradição": 1,
      stale: 0,
    });
  });
});

describe("(b) repository_verified_count requires status comprovado AND repository evidence on the same entity", () => {
  const records = [
    entity({ id: "ok", status: "comprovado", repo: repoUri(REV) }),
    entity({ id: "comprovado-no-repo", status: "comprovado" }),
    entity({ id: "repo-but-hipotese", status: "hipótese", repo: repoUri(REV) }),
    entity({ id: "comprovado-wrong-rev", status: "comprovado", repo: repoUri(OTHER_REV) }),
  ];
  const report = coverageReport(baseArgs({ records }));

  test("counts exactly the one entity that is comprovado AND verified at source_revision", () => {
    assert.strictEqual(report.provenance.repository_verified_count, 1);
    assert.strictEqual(report.provenance.repository_verified_percentage, 25);
  });
});

describe("(c) artifact_reference_count counts only artifact evidence that resolves against the manifest", () => {
  const base = validArtifact();
  const records = [
    entity({ id: "valid", status: "comprovado", repo: repoUri(REV), artifact: base }),
    entity({
      id: "manifest-id-mismatch",
      status: "comprovado",
      repo: repoUri(REV),
      artifact: { ...base, manifest_id: "manifest:other" },
    }),
    entity({
      id: "path-missing",
      status: "comprovado",
      repo: repoUri(REV),
      artifact: { ...base, artifact_path: ".claude/explorer/missing.md" },
    }),
    entity({
      id: "sha-mismatch",
      status: "comprovado",
      repo: repoUri(REV),
      artifact: { ...base, content_sha256: "b".repeat(64) },
    }),
    entity({
      id: "range-inverted",
      status: "comprovado",
      repo: repoUri(REV),
      artifact: { ...base, range: { start_line: 20, end_line: 10 } },
    }),
  ];
  const report = coverageReport(baseArgs({ records }));

  test("counts exactly the entity whose manifest_id/path/hash/range all resolve", () => {
    assert.strictEqual(report.provenance.artifact_reference_count, 1);
    assert.strictEqual(report.provenance.artifact_reference_percentage, 20);
  });
});

describe("(d) producer_baseline emits deterministic deltas with non-empty explanations and pass/fail", () => {
  test("derives sorted deltas (indexed - declared) with explanations and result pass", () => {
    const report = coverageReport(
      baseArgs({
        producerDeclaredCounts: { endpoints: 10, services: 4 },
        producerIndexedCounts: { endpoints: 10, services: 5, events: 2 },
        producerExplanations: {
          endpoints: "exact match",
          services: "private service not indexed",
          events: "newly discovered topic",
        },
      }),
    );
    assert.deepStrictEqual(report.producer_baseline.deltas, [
      { metric: "endpoints", declared: 10, indexed: 10, delta: 0, explanation: "exact match" },
      { metric: "events", declared: 0, indexed: 2, delta: 2, explanation: "newly discovered topic" },
      { metric: "services", declared: 4, indexed: 5, delta: 1, explanation: "private service not indexed" },
    ]);
    assert.strictEqual(report.producer_baseline.result, "pass");
  });

  test("result is fail when any metric lacks a non-empty explanation", () => {
    const report = coverageReport(
      baseArgs({
        producerDeclaredCounts: { endpoints: 10, services: 4 },
        producerIndexedCounts: { endpoints: 9 },
        producerExplanations: { endpoints: "one dropped" },
      }),
    );
    assert.strictEqual(report.producer_baseline.result, "fail");
    assert.strictEqual(
      report.producer_baseline.deltas.find((d) => d.metric === "services").explanation,
      "",
    );
  });

  test("delta may be negative when the index under-counts the producer declaration", () => {
    const report = coverageReport(
      baseArgs({
        producerDeclaredCounts: { x: 5 },
        producerIndexedCounts: { x: 3 },
        producerExplanations: { x: "two lost in adaptation" },
      }),
    );
    assert.strictEqual(report.producer_baseline.deltas[0].delta, -2);
  });
});

describe("(e) passed is the computed invariant of threshold implications and repository_verified_percentage", () => {
  function passingBase() {
    return baseArgs({
      records: [
        entity({ id: "ok", status: "comprovado", repo: repoUri(REV) }),
        entity({ id: "hip", status: "hipótese" }),
      ],
      schemaResult: { valid: true, errors: [] },
      repeatability: { result: "pass", canonical_graph_hash: SHA },
      mutation: { pre: { summary_hash: SHA }, post: { summary_hash: SHA }, equivalent: true },
      producerDeclaredCounts: { m: 1 },
      producerIndexedCounts: { m: 1 },
      producerExplanations: { m: "match" },
      threshold: {
        minimum_repository_verified_percentage: 50,
        require_schema_valid: true,
        require_repeatability_pass: true,
        require_mutation_equivalent: true,
        require_producer_reconciliation_pass: true,
      },
    });
  }

  test("passed=true when every required lever is satisfied and coverage meets the minimum", () => {
    assert.strictEqual(coverageReport(passingBase()).passed, true);
  });

  test("require_schema_valid=true with invalid schema forces passed=false", () => {
    const r = coverageReport({
      ...passingBase(),
      schemaResult: { valid: false, errors: [{ path: "/records/0", message: "bad" }] },
    });
    assert.strictEqual(r.passed, false);
  });

  test("require_repeatability_pass=true with result=fail forces passed=false", () => {
    const r = coverageReport({
      ...passingBase(),
      repeatability: { result: "fail", canonical_graph_hash: SHA },
    });
    assert.strictEqual(r.passed, false);
  });

  test("require_mutation_equivalent=true with equivalent=false forces passed=false", () => {
    const r = coverageReport({
      ...passingBase(),
      mutation: { pre: { summary_hash: SHA }, post: { summary_hash: "c".repeat(64) }, equivalent: false },
    });
    assert.strictEqual(r.passed, false);
  });

  test("require_producer_reconciliation_pass=true with a missing explanation forces passed=false", () => {
    const r = coverageReport({ ...passingBase(), producerExplanations: {} });
    assert.strictEqual(r.passed, false);
  });

  test("repository_verified_percentage below the minimum forces passed=false", () => {
    const base = passingBase();
    const r = coverageReport({
      ...base,
      threshold: { ...base.threshold, minimum_repository_verified_percentage: 51 },
    });
    assert.strictEqual(r.passed, false);
  });

  test("require_* implications hold vacuously when their flag is false even if the condition is violated", () => {
    const r = coverageReport({
      ...passingBase(),
      schemaResult: { valid: false, errors: [] },
      repeatability: { result: "fail", canonical_graph_hash: SHA },
      mutation: { pre: { summary_hash: SHA }, post: { summary_hash: SHA }, equivalent: false },
      producerExplanations: {},
      threshold: {
        minimum_repository_verified_percentage: 50,
        require_schema_valid: false,
        require_repeatability_pass: false,
        require_mutation_equivalent: false,
        require_producer_reconciliation_pass: false,
      },
    });
    assert.strictEqual(r.passed, true);
  });

  test("zero entities yields repository_verified_percentage=0; with minimum 0 the coverage lever passes", () => {
    const r = coverageReport({
      ...passingBase(),
      records: [],
      relations: [],
      threshold: {
        minimum_repository_verified_percentage: 0,
        require_schema_valid: false,
        require_repeatability_pass: false,
        require_mutation_equivalent: false,
        require_producer_reconciliation_pass: false,
      },
    });
    assert.strictEqual(r.provenance.repository_verified_percentage, 0);
    assert.strictEqual(r.provenance.artifact_reference_percentage, 0);
    assert.strictEqual(r.passed, true);
  });

  test("zero entities with minimum_repository_verified_percentage > 0 forces passed=false", () => {
    const r = coverageReport({
      ...passingBase(),
      records: [],
      relations: [],
      threshold: {
        minimum_repository_verified_percentage: 1,
        require_schema_valid: false,
        require_repeatability_pass: false,
        require_mutation_equivalent: false,
        require_producer_reconciliation_pass: false,
      },
    });
    assert.strictEqual(r.passed, false);
  });
});

describe("percentage derivation uses real division (not integer truncation)", () => {
  test("1 of 3 verified entities yields ~33.33% within the open interval (33, 34)", () => {
    const records = [
      entity({ id: "ok", status: "comprovado", repo: repoUri(REV) }),
      entity({ id: "h1", status: "hipótese" }),
      entity({ id: "h2", status: "hipótese" }),
    ];
    const r = coverageReport(baseArgs({ records }));
    assert.ok(r.provenance.repository_verified_percentage > 33);
    assert.ok(r.provenance.repository_verified_percentage < 34);
  });
});

describe("deterministic ordering of unresolved_ids", () => {
  test("unresolved_ids are emitted sorted lexicographically regardless of input order", () => {
    const r = coverageReport(baseArgs({ unresolvedIds: ["z:3", "a:1", "m:2"] }));
    assert.deepStrictEqual(r.unresolved_ids, ["a:1", "m:2", "z:3"]);
  });
});

describe("rejection — CoverageReportError", () => {
  test("rejects empty id", () => {
    assert.throws(() => coverageReport(baseArgs({ id: "" })), CoverageReportError);
  });

  test("rejects empty namespace", () => {
    assert.throws(() => coverageReport(baseArgs({ namespace: "" })), CoverageReportError);
  });

  test("rejects empty source_revision", () => {
    assert.throws(() => coverageReport(baseArgs({ sourceRevision: "" })), CoverageReportError);
  });

  test("rejects empty artifact_manifest_id", () => {
    assert.throws(() => coverageReport(baseArgs({ artifactManifestId: "" })), CoverageReportError);
  });

  test("rejects empty graph_index_id", () => {
    assert.throws(() => coverageReport(baseArgs({ graphIndexId: "" })), CoverageReportError);
  });

  test("rejects manifest missing id", () => {
    assert.throws(
      () => coverageReport(baseArgs({ manifest: { artifacts: [] } })),
      CoverageReportError,
    );
  });

  test("rejects manifest with non-array artifacts", () => {
    assert.throws(
      () => coverageReport(baseArgs({ manifest: { id: MANIFEST_ID, artifacts: "nope" } })),
      CoverageReportError,
    );
  });

  test("rejects threshold missing minimum_repository_verified_percentage", () => {
    assert.throws(
      () =>
        coverageReport(
          baseArgs({
            threshold: {
              require_schema_valid: false,
              require_repeatability_pass: false,
              require_mutation_equivalent: false,
              require_producer_reconciliation_pass: false,
            },
          }),
        ),
      CoverageReportError,
    );
  });
});
