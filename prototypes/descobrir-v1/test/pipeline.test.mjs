/**
 * Seam under test (pre-agreed): end-to-end Descobrir v1 pipeline composition.
 * runDescobrir({config, prototypeRoot, dependencies, observedAt}) orchestrates
 * acquire → adapt×2 → verify×2 → graph index → schema → mutation → coverage → persist.
 * Target IO is injected; fixtures supply synthetic Explorer artifacts + source bytes.
 * Module does not exist yet — this import MUST fail first (RED), then pass.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { runDescobrir, PipelineError } from "../src/pipeline.mjs";
import { validateCoverageReport } from "../src/schema/descobrir.mjs";
import { persistGraphOutput } from "../src/graph-persistence.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_EXPLORER = join(here, "..", "fixtures", "explorer");
const SOURCE_FIXTURE = readFileSync(
  join(here, "..", "fixtures", "source", "domains", "iam", "controller", "service_register.go"),
  "utf8",
);

const REV = "633d3a5d16c165073ede2b2248bae708483f2efe";
const NAMESPACE = "nori-cloud";
const LOGICAL_REPO = "nori-cloud";
const ABS_REPO_SENTINEL = "/tmp/descobrir-pipeline-ABS_REPO_PATH_SENTINEL";
const RAW_ARTIFACT_SENTINEL = "RAW_ARTIFACT_BODY_SENTINEL_NEVER_PERSIST";
const RAW_SOURCE_SENTINEL = "RAW_SOURCE_BODY_SENTINEL_NEVER_PERSIST";
const OBSERVED_AT = "2026-08-02T12:00:00.000Z";

const SNAPSHOT = Object.freeze({
  summary_hash: "b".repeat(64),
  tracked_file_count: 42,
  dirty_path_count: 2,
  anchor_object_present: true,
});

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function walkFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(full);
  }
  return out;
}

function loadFixtureArtifacts() {
  return walkFiles(FIXTURE_EXPLORER)
    .map((full) => {
      const rel = full.slice(FIXTURE_EXPLORER.length + 1).split("\\").join("/");
      const path = `.claude/explorer/${rel}`;
      const content = readFileSync(full, "utf8");
      const contentSha256 = sha256(content);
      return {
        path,
        content,
        contentSha256,
        content_sha256: contentSha256,
        byteLength: Buffer.byteLength(content, "utf8"),
        role: "native",
        declaredRevision: REV,
        declared_revision: REV,
        status: "complete",
        native: true,
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function makeConfig(prototypeRoot, overrides = {}) {
  return {
    namespace: NAMESPACE,
    logical_repo: LOGICAL_REPO,
    source_revision: REV,
    resolver: { [LOGICAL_REPO]: ABS_REPO_SENTINEL },
    engine: {
      name: "explorer",
      profile: "nori-cloud-api",
      root: ".claude/explorer",
    },
    output: resolve(prototypeRoot, "output"),
    threshold: {
      minimum_repository_verified_percentage: 0,
      require_schema_valid: true,
      require_repeatability_pass: true,
      require_mutation_equivalent: true,
      require_producer_reconciliation_pass: true,
    },
    ...overrides,
  };
}

function makeHarness(context) {
  const tempRoot = mkdtempSync(join(tmpdir(), "descobrir-pipeline-"));
  context.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const prototypeRoot = join(tempRoot, "prototype");
  mkdirSync(prototypeRoot, { recursive: true });
  return { tempRoot, prototypeRoot };
}

function countingFakes(artifacts) {
  const calls = { acquire: 0, snapshot: 0, read: 0, persist: 0 };
  const readLog = [];

  const dependencies = {
    acquireArtifacts() {
      calls.acquire += 1;
      return artifacts.map((a) => ({ ...a, content: a.content }));
    },
    repositorySnapshot() {
      calls.snapshot += 1;
      return { ...SNAPSHOT };
    },
    readFileAtRevision({ revision, path }) {
      calls.read += 1;
      readLog.push({ revision, path });
      if (path === "domains/iam/controller/service_register.go") {
        return SOURCE_FIXTURE;
      }
      const err = new Error(`missing ${path}`);
      err.name = "GitSourceError";
      throw err;
    },
    persistGraphOutput(args) {
      calls.persist += 1;
      return persistGraphOutput(args);
    },
  };

  return { dependencies, calls, readLog };
}

function jsonBlob(value) {
  return JSON.stringify(value);
}

function assertNoLeak(blob, label) {
  assert.ok(!blob.includes(ABS_REPO_SENTINEL), `${label} must not contain absolute repo path`);
  assert.ok(!blob.includes(RAW_ARTIFACT_SENTINEL), `${label} must not contain raw artifact sentinel`);
  assert.ok(!blob.includes(RAW_SOURCE_SENTINEL), `${label} must not contain raw source sentinel`);
  assert.ok(!blob.includes(SOURCE_FIXTURE.slice(0, 40)), `${label} must not embed source fixture body`);
}

describe("runDescobrir — happy path with injected target IO", () => {
  test("composes full pipeline: schemas valid, repeatability, mutation, coverage, six docs", (context) => {
    const { prototypeRoot } = makeHarness(context);
    const artifacts = loadFixtureArtifacts();
    // Poison one artifact content copy only in memory after load — ensure pipeline
    // never persists raw content even if a sentinel string were present.
    const poisoned = artifacts.map((a, i) =>
      i === 0 ? { ...a, content: `${a.content}\n${RAW_ARTIFACT_SENTINEL}\n` } : a,
    );
    const { dependencies, calls } = countingFakes(poisoned);
    const config = makeConfig(prototypeRoot);

    const result = runDescobrir({
      config,
      prototypeRoot,
      dependencies,
      observedAt: OBSERVED_AT,
    });

    assert.strictEqual(calls.acquire, 1, "acquisition once");
    assert.strictEqual(calls.snapshot, 2, "target snapshot pre + post");
    assert.ok(calls.read >= 1, "fake reader used for promotion");
    assert.strictEqual(calls.persist, 1);

    assert.ok(result.manifest);
    assert.ok(result.records);
    assert.ok(result.relations);
    assert.ok(result.graphIndex);
    assert.ok(result.coverageReport);
    assert.ok(result.adapterProfile);

    // Manifest entries: schema fields only
    for (const entry of result.manifest.artifacts) {
      const keys = Object.keys(entry).sort();
      for (const k of keys) {
        assert.ok(
          ["path", "content_sha256", "role", "declared_revision", "byte_length", "status", "media_type"].includes(k),
          `unexpected manifest entry field: ${k}`,
        );
      }
      assert.ok(!("content" in entry));
      assert.ok(!("contentSha256" in entry));
      assert.ok(!("native" in entry));
      assert.ok(!entry.path.startsWith("/"));
    }
    assert.strictEqual(result.manifest.acquisition_mode, "reused");
    assert.deepStrictEqual(result.manifest.engine, {
      name: "explorer",
      profile: "nori-cloud-api",
    });
    assert.deepStrictEqual(result.manifest.adapter, {
      name: "explorer-adapter",
      version: "0.1.0",
    });

    // At least one fixture-backed entity promoted
    const promoted = [...result.records, ...result.relations].filter((e) => e.status === "comprovado");
    assert.ok(promoted.length >= 1, "expected ≥1 comprovado entity via fake reader");

    const report = result.coverageReport;
    assert.strictEqual(report.repeatability.result, "pass");
    assert.strictEqual(report.mutation.equivalent, true);
    assert.strictEqual(report.passed, true);
    assert.strictEqual(report.schema_result.valid, true);
    assert.deepStrictEqual(report.schema_result.errors, []);
    assert.strictEqual(report.threshold.minimum_repository_verified_percentage, 0);
    assert.strictEqual(report.freshness.observed_at, OBSERVED_AT);
    assert.match(report.id, new RegExp(`^coverage:${result.graphIndex.canonical_graph_hash}$`));

    // Producer metrics in declared namespace with explanations
    const pb = report.producer_baseline;
    assert.strictEqual(pb.result, "pass");
    for (const metric of ["endpoints", "flows", "consumers", "producers", "insights"]) {
      assert.ok(metric in pb.declared_counts, `missing declared ${metric}`);
      assert.ok(metric in pb.indexed_counts, `missing indexed ${metric}`);
    }
    assert.strictEqual(pb.indexed_counts.endpoints, result.records.filter((r) => r.type === "Endpoint").length);
    assert.strictEqual(pb.indexed_counts.flows, result.records.filter((r) => r.type === "Flow").length);
    assert.strictEqual(
      pb.indexed_counts.consumers,
      result.relations.filter((r) => r.relation_type === "CONSUMES").length,
    );
    assert.strictEqual(
      pb.indexed_counts.producers,
      result.relations.filter((r) => r.relation_type === "PUBLISHES").length,
    );
    assert.strictEqual(pb.indexed_counts.insights, 0);
    for (const d of pb.deltas) {
      assert.ok(typeof d.explanation === "string" && d.explanation.length > 0);
      if (d.delta === 0) assert.strictEqual(d.explanation, "exact match");
    }

    // Six persisted docs
    const outputRoot = join(prototypeRoot, "output");
    const files = readdirSync(outputRoot).sort();
    assert.deepStrictEqual(files, [
      "adapter-profile.json",
      "artifact-manifest.json",
      "coverage-report.json",
      "graph-index.json",
      "knowledge-records.json",
      "relations.json",
    ]);

    const persistedCoverage = JSON.parse(readFileSync(join(outputRoot, "coverage-report.json"), "utf8"));
    const reval = validateCoverageReport(persistedCoverage);
    assert.strictEqual(reval.valid, true, JSON.stringify(reval.errors));
    assert.strictEqual(persistedCoverage.passed, true);

    // No leaks in returned or persisted JSON
    assertNoLeak(jsonBlob(result), "return value");
    for (const name of files) {
      assertNoLeak(readFileSync(join(outputRoot, name), "utf8"), name);
    }

    // Graph hash independent of observedAt
    const otherRoot = join(prototypeRoot, "..", "prototype-b");
    mkdirSync(otherRoot, { recursive: true });
    const again = runDescobrir({
      config: makeConfig(otherRoot),
      prototypeRoot: otherRoot,
      dependencies: countingFakes(loadFixtureArtifacts()).dependencies,
      observedAt: "2099-01-01T00:00:00.000Z",
    });
    assert.strictEqual(again.graphIndex.canonical_graph_hash, result.graphIndex.canonical_graph_hash);
  });
});

describe("runDescobrir — output path gate", () => {
  test("rejects mismatched output before any target IO", (context) => {
    const { prototypeRoot } = makeHarness(context);
    const { dependencies, calls } = countingFakes(loadFixtureArtifacts());
    const config = makeConfig(prototypeRoot, {
      output: resolve(prototypeRoot, "elsewhere"),
    });

    assert.throws(
      () =>
        runDescobrir({
          config,
          prototypeRoot,
          dependencies,
          observedAt: OBSERVED_AT,
        }),
      (err) => {
        assert.ok(err instanceof PipelineError);
        assert.match(err.message, /output/i);
        return true;
      },
    );

    assert.strictEqual(calls.acquire, 0);
    assert.strictEqual(calls.snapshot, 0);
    assert.strictEqual(calls.read, 0);
    assert.strictEqual(calls.persist, 0);
    assert.ok(!readdirSync(prototypeRoot).includes("output"));
  });
});
