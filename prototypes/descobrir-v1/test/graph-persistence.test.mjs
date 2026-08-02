import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  canonicalGraphHash,
  createArtifactManifest,
  createGraphIndex,
  OutputConfinementError,
  persistGraphOutput,
} from "../src/graph-persistence.mjs";

const RECORD = {
  id: "service:billing",
  namespace: "nori",
  type: "Service",
  name: "Billing",
  summary: "Narrative metadata must not affect identity.",
  attributes: { z: 2, a: 1 },
  status: "hipótese",
  source_revision: "abc123",
  source_engine: {
    name: "explorer",
    profile: "api",
    adapter_version: "0.1.0",
    artifact_manifest_id: "manifest:x",
  },
  evidence: [
    {
      kind: "artifact",
      manifest_id: "manifest:x",
      artifact_path: ".claude/explorer/endpoints.md",
      content_sha256: "a".repeat(64),
      range: { start_line: 1, end_line: 2 },
    },
  ],
};

describe("canonicalGraphHash", () => {
  test("hashes the complete structural graph using stable object-key ordering", () => {
    assert.strictEqual(
      canonicalGraphHash({ records: [RECORD], relations: [] }),
      "89bc340fd8da2f8eddb6cbc7541c41ac6028913743768297b6ddce690f169519",
    );
  });

  test("is independent of record and relation discovery order", () => {
    const secondRecord = { ...RECORD, id: "service:orders", name: "Orders" };
    const firstRelation = {
      id: "exposes:service:billing:endpoint:get:/billing",
      namespace: "nori",
      from_record: "service:billing",
      relation_type: "EXPOSES",
      to_record: "endpoint:get:/billing",
      status: "hipótese",
      source_revision: "abc123",
      source_engine: RECORD.source_engine,
      evidence: RECORD.evidence,
    };
    const secondRelation = {
      ...firstRelation,
      id: "exposes:service:orders:endpoint:get:/orders",
      from_record: "service:orders",
      to_record: "endpoint:get:/orders",
    };

    const forward = canonicalGraphHash({
      records: [RECORD, secondRecord],
      relations: [firstRelation, secondRelation],
    });
    const reversed = canonicalGraphHash({
      records: [secondRecord, RECORD],
      relations: [secondRelation, firstRelation],
    });

    assert.strictEqual(reversed, forward);
  });
});

describe("createArtifactManifest", () => {
  test("derives stable identity from normative fields and sorted artifact hashes", () => {
    const base = {
      namespace: "nori",
      logicalRepo: "nori-cloud",
      sourceRevision: "abc123",
      engine: { name: "explorer", profile: "api" },
      adapter: { name: "explorer-adapter", version: "0.1.0" },
    };
    const firstArtifact = {
      path: ".claude/explorer/endpoints.md",
      content_sha256: "a".repeat(64),
      role: "native",
      declared_revision: "abc123",
      status: "complete",
    };
    const secondArtifact = {
      path: ".claude/explorer/flows/checkout.md",
      content_sha256: "b".repeat(64),
      role: "native",
      declared_revision: "abc123",
      status: "complete",
    };

    const reused = createArtifactManifest({
      ...base,
      acquisitionMode: "reused",
      artifacts: [secondArtifact, firstArtifact],
      freshness: { source_revision: "abc123", observed_at: "2026-08-02T10:00:00Z" },
    });
    const fresh = createArtifactManifest({
      ...base,
      acquisitionMode: "fresh",
      artifacts: [firstArtifact, secondArtifact],
      freshness: { source_revision: "abc123", observed_at: "2026-08-02T11:00:00Z" },
    });

    assert.match(reused.id, /^manifest:[a-f0-9]{64}$/);
    assert.strictEqual(fresh.id, reused.id);
    assert.deepStrictEqual(
      reused.artifacts.map(({ path }) => path),
      [firstArtifact.path, secondArtifact.path],
    );
    assert.strictEqual(reused.acquisition_mode, "reused");
    assert.deepStrictEqual(reused.freshness, {
      source_revision: "abc123",
      observed_at: "2026-08-02T10:00:00Z",
    });
  });
});

describe("createGraphIndex", () => {
  test("derives sorted navigation and counts from the complete graph", () => {
    const secondRecord = { ...RECORD, id: "service:orders", name: "Orders" };
    const graph = { records: [secondRecord, RECORD], relations: [] };
    const index = createGraphIndex({
      namespace: "nori",
      sourceRevision: "abc123",
      artifactManifestId: "manifest:x",
      engine: { name: "explorer", profile: "api" },
      graph,
      metadata: { generated_at: "2026-08-02T10:00:00Z" },
    });

    assert.deepStrictEqual(index.record_ids, ["service:billing", "service:orders"]);
    assert.deepStrictEqual(index.relation_ids, []);
    assert.deepStrictEqual(index.counts, { records: 2, relations: 0 });
    assert.strictEqual(index.canonical_graph_hash, canonicalGraphHash(graph));
    assert.strictEqual(index.id, `graph-index:${index.canonical_graph_hash}`);
    assert.deepStrictEqual(index.metadata, { generated_at: "2026-08-02T10:00:00Z" });
  });
});

describe("persistGraphOutput", () => {
  test("writes only the fixed structured documents below prototypeRoot/output", (context) => {
    const tempRoot = mkdtempSync(join(tmpdir(), "descobrir-persistence-"));
    context.after(() => rmSync(tempRoot, { recursive: true, force: true }));
    const prototypeRoot = join(tempRoot, "prototype");
    mkdirSync(prototypeRoot);

    const records = [{ ...RECORD, id: "service:orders" }, RECORD];
    const relations = [];
    const graphIndex = createGraphIndex({
      namespace: "nori",
      sourceRevision: "abc123",
      artifactManifestId: "manifest:x",
      engine: { name: "explorer", profile: "api" },
      graph: { records, relations },
    });

    persistGraphOutput({
      prototypeRoot,
      manifest: { id: "manifest:x" },
      coverageReport: {
        passed: true,
        provenance_coverage: 1,
        repeatability: 1,
        mutation: { equivalent: 0 },
      },
      records,
      relations,
      graphIndex,
      adapterProfile: { name: "explorer", version: "0.1.0" },
    });

    const outputRoot = join(prototypeRoot, "output");
    assert.deepStrictEqual(readdirSync(outputRoot).sort(), [
      "adapter-profile.json",
      "artifact-manifest.json",
      "coverage-report.json",
      "graph-index.json",
      "knowledge-records.json",
      "relations.json",
    ]);
    assert.strictEqual(statSync(join(outputRoot, "coverage-report.json")).mode & 0o777, 0o600);
    const persistedRecords = JSON.parse(
      readFileSync(join(outputRoot, "knowledge-records.json"), "utf8"),
    );
    assert.deepStrictEqual(
      persistedRecords.map(({ id }) => id),
      ["service:billing", "service:orders"],
    );
    assert.deepStrictEqual(
      JSON.parse(readFileSync(join(outputRoot, "coverage-report.json"), "utf8")),
      {
        mutation: { equivalent: 0 },
        passed: true,
        provenance_coverage: 1,
        repeatability: 1,
      },
    );
  });

  test("rejects an output symlink that escapes the prototype root before writing", (context) => {
    const tempRoot = mkdtempSync(join(tmpdir(), "descobrir-confinement-"));
    context.after(() => rmSync(tempRoot, { recursive: true, force: true }));
    const prototypeRoot = join(tempRoot, "prototype");
    const outsideRoot = join(tempRoot, "outside");
    mkdirSync(prototypeRoot);
    mkdirSync(outsideRoot);
    symlinkSync(outsideRoot, join(prototypeRoot, "output"));

    assert.throws(
      () =>
        persistGraphOutput({
          prototypeRoot,
          manifest: { id: "manifest:x" },
          coverageReport: { passed: true },
          records: [],
          relations: [],
          graphIndex: { id: "graph-index:x" },
          adapterProfile: { name: "explorer" },
        }),
      OutputConfinementError,
    );
    assert.deepStrictEqual(readdirSync(outsideRoot), []);
  });
});
