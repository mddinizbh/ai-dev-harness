import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// Seam under test (pre-agreed, ADR 0002): Artifact Adapter for Explorer native
// artifacts → Knowledge Records + Relations. Module does not exist yet — RED first.
import { adaptExplorer } from "../src/explorer-adapter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, "..", "fixtures", "explorer");

const NAMESPACE = "nori-cloud";
const LOGICAL_REPO = "nori-cloud";
const SOURCE_REVISION = "633d3a5d16c165073ede2b2248bae708483f2efe";
const ENGINE_NAME = "explorer";
const ENGINE_PROFILE = "nori-cloud-api";
const ADAPTER_VERSION = "0.1.0";
const MANIFEST_ID = "manifest:fixture-test";

const EXPECTED_SOURCE_ENGINE = {
  name: ENGINE_NAME,
  profile: ENGINE_PROFILE,
  adapter_version: ADAPTER_VERSION,
  artifact_manifest_id: MANIFEST_ID,
};

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function walkFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkFiles(full, base));
    } else {
      out.push(full);
    }
  }
  return out;
}

function loadFixtureArtifacts() {
  return walkFiles(FIXTURE_ROOT).map((full) => {
    const relInside = relative(FIXTURE_ROOT, full).split("\\").join("/");
    const path = `.claude/explorer/${relInside}`;
    const content = readFileSync(full, "utf8");
    return { path, content, contentSha256: sha256(content) };
  });
}

function byId(items) {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

function assertArtifactEvidence(evidence, artifactPath) {
  const arts = evidence.filter((e) => e.kind === "artifact");
  assert.ok(arts.length >= 1, `expected ≥1 artifact evidence for ${artifactPath ?? "item"}`);
  for (const a of arts) {
    assert.strictEqual(a.kind, "artifact");
    assert.strictEqual(a.manifest_id, MANIFEST_ID);
    assert.ok(typeof a.artifact_path === "string" && a.artifact_path.length > 0);
    assert.match(a.content_sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isInteger(a.range.start_line) && a.range.start_line >= 1);
    assert.ok(Number.isInteger(a.range.end_line) && a.range.end_line >= a.range.start_line);
    if (artifactPath) {
      assert.strictEqual(a.artifact_path, artifactPath);
    }
  }
}

function assertCommonFields(entity, { isRelation = false } = {}) {
  assert.strictEqual(entity.namespace, NAMESPACE);
  assert.strictEqual(entity.status, "hipótese");
  assert.strictEqual(entity.source_revision, SOURCE_REVISION);
  assert.deepStrictEqual(entity.source_engine, EXPECTED_SOURCE_ENGINE);
  assert.ok(Array.isArray(entity.evidence) && entity.evidence.length >= 1);
  assertArtifactEvidence(entity.evidence);
  if (isRelation) {
    assert.ok(entity.from_record && entity.to_record && entity.relation_type);
  } else {
    assert.ok(entity.type && entity.name && typeof entity.summary === "string");
    assert.ok(entity.attributes && typeof entity.attributes === "object");
  }
}

describe("adaptExplorer — fixture vertical slice", () => {
  const artifacts = loadFixtureArtifacts();
  const input = {
    namespace: NAMESPACE,
    logicalRepo: LOGICAL_REPO,
    sourceRevision: SOURCE_REVISION,
    engineName: ENGINE_NAME,
    engineProfile: ENGINE_PROFILE,
    adapterVersion: ADAPTER_VERSION,
    manifestId: MANIFEST_ID,
    artifacts,
  };

  test("returns records, relations, declaredCounts and adapterProfile", () => {
    const result = adaptExplorer(input);
    assert.ok(Array.isArray(result.records));
    assert.ok(Array.isArray(result.relations));
    assert.deepStrictEqual(result.declaredCounts, {
      endpoints: 2,
      consumers: 1,
      producers: 1,
      flows: 1,
      insights: 0,
    });
    assert.ok(result.adapterProfile);
    assert.ok(result.adapterProfile.recordTypes);
    assert.ok(result.adapterProfile.relationTypes);
  });

  test("emits deterministic sorted Knowledge Records with expected ids", () => {
    const { records } = adaptExplorer(input);
    const ids = records.map((r) => r.id);
    assert.deepStrictEqual(ids, [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));

    const expectedIds = [
      "endpoint:post:/api/v1/iam/auth/login",
      "endpoint:post:/api/v1/iam/auth/register",
      "event:iam/events/register/v1.event",
      "flow:post-iam-auth-register",
      "service:iam",
      "table:iam:iam_tenants",
      "table:iam:iam_user_tenants",
      "table:iam:iam_user_tokens",
      "table:iam:iam_users",
    ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    assert.deepStrictEqual(ids, expectedIds);

    for (const rec of records) {
      assertCommonFields(rec);
    }
  });

  test("service and endpoints come from endpoints.md with EXPOSES relations", () => {
    const { records, relations } = adaptExplorer(input);
    const map = byId(records);

    assert.strictEqual(map["service:iam"].type, "Service");
    assert.strictEqual(map["service:iam"].name, "iam");

    const reg = map["endpoint:post:/api/v1/iam/auth/register"];
    assert.strictEqual(reg.type, "Endpoint");
    assert.strictEqual(reg.attributes.method, "POST");
    assert.strictEqual(reg.attributes.path, "/api/v1/iam/auth/register");

    const login = map["endpoint:post:/api/v1/iam/auth/login"];
    assert.strictEqual(login.type, "Endpoint");
    assert.strictEqual(login.attributes.method, "POST");
    assert.strictEqual(login.attributes.path, "/api/v1/iam/auth/login");

    const exposes = relations.filter((r) => r.relation_type === "EXPOSES");
    assert.strictEqual(exposes.length, 2);
    const exposeTargets = new Set(exposes.map((r) => r.to_record));
    assert.ok(exposeTargets.has("endpoint:post:/api/v1/iam/auth/register"));
    assert.ok(exposeTargets.has("endpoint:post:/api/v1/iam/auth/login"));
    for (const rel of exposes) {
      assert.strictEqual(rel.from_record, "service:iam");
      assertCommonFields(rel, { isRelation: true });
      assertArtifactEvidence(rel.evidence, ".claude/explorer/endpoints.md");
    }

    assertArtifactEvidence(reg.evidence, ".claude/explorer/endpoints.md");
    assertArtifactEvidence(map["service:iam"].evidence, ".claude/explorer/endpoints.md");
  });

  test("flow record and TRIGGERS relation from flow frontmatter", () => {
    const { records, relations } = adaptExplorer(input);
    const flow = byId(records)["flow:post-iam-auth-register"];
    assert.strictEqual(flow.type, "Flow");
    assert.strictEqual(flow.name, "post-iam-auth-register");
    assert.ok(
      flow.attributes.trigger === "POST /api/v1/iam/auth/register" ||
        flow.attributes.trigger?.includes("POST /api/v1/iam/auth/register"),
    );

    const triggers = relations.filter((r) => r.relation_type === "TRIGGERS");
    assert.strictEqual(triggers.length, 1);
    assert.strictEqual(triggers[0].from_record, "endpoint:post:/api/v1/iam/auth/register");
    assert.strictEqual(triggers[0].to_record, "flow:post-iam-auth-register");
    assertCommonFields(triggers[0], { isRelation: true });
    assertArtifactEvidence(flow.evidence, ".claude/explorer/flows/post-iam-auth-register.md");

    // Flow body has path:line → repository evidence allowed, still hipótese
    const repoEv = flow.evidence.filter((e) => e.kind === "repository");
    assert.ok(repoEv.length >= 1, "flow should carry repository evidence from path:line refs");
    for (const e of repoEv) {
      assert.match(e.uri, /^repo:\/\/nori-cloud@633d3a5d16c165073ede2b2248bae708483f2efe\//);
    }
    assert.strictEqual(flow.status, "hipótese");
  });

  test("normalizes producer/consumer events to one Event record with PUBLISHES and CONSUMES", () => {
    const { records, relations } = adaptExplorer(input);
    const event = byId(records)["event:iam/events/register/v1.event"];
    assert.ok(event, "expected single normalized event record");
    assert.strictEqual(event.type, "Event");

    const publishes = relations.filter((r) => r.relation_type === "PUBLISHES");
    assert.strictEqual(publishes.length, 1);
    assert.strictEqual(publishes[0].from_record, "service:iam");
    assert.strictEqual(publishes[0].to_record, "event:iam/events/register/v1.event");
    assertCommonFields(publishes[0], { isRelation: true });

    const consumes = relations.filter((r) => r.relation_type === "CONSUMES");
    assert.strictEqual(consumes.length, 1);
    assert.strictEqual(consumes[0].from_record, "service:iam");
    assert.strictEqual(consumes[0].to_record, "event:iam/events/register/v1.event");
    assertCommonFields(consumes[0], { isRelation: true });

    // Producer call site → repository evidence on PUBLISHES or event
    const pubRepo = publishes[0].evidence.filter((e) => e.kind === "repository");
    assert.ok(pubRepo.length >= 1);
    assert.match(
      pubRepo[0].uri,
      /domains\/iam\/controller\/service_register\.go#L60-L60$/,
    );
  });

  test("database tables and PERSISTS_TO relations", () => {
    const { records, relations } = adaptExplorer(input);
    const map = byId(records);
    for (const id of [
      "table:iam:iam_tenants",
      "table:iam:iam_users",
      "table:iam:iam_user_tenants",
      "table:iam:iam_user_tokens",
    ]) {
      assert.ok(map[id], `missing ${id}`);
      assert.strictEqual(map[id].type, "Table");
      assertCommonFields(map[id]);
      assertArtifactEvidence(map[id].evidence, ".claude/explorer/database.md");
    }

    const persists = relations.filter((r) => r.relation_type === "PERSISTS_TO");
    assert.strictEqual(persists.length, 4);
    for (const rel of persists) {
      assert.strictEqual(rel.from_record, "service:iam");
      assert.match(rel.to_record, /^table:iam:/);
      assertCommonFields(rel, { isRelation: true });
    }

    const dbRepo = map["table:iam:iam_tenants"].evidence.filter((e) => e.kind === "repository");
    assert.ok(dbRepo.length >= 1);
    assert.match(dbRepo[0].uri, /domains\/iam\/store\/store\.go#L15-L15$/);
  });

  test("relations are sorted by id and never comprovado", () => {
    const { relations } = adaptExplorer(input);
    const ids = relations.map((r) => r.id);
    assert.deepStrictEqual(ids, [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    assert.strictEqual(relations.length, 2 + 1 + 1 + 1 + 4);
    for (const rel of relations) {
      assert.strictEqual(rel.status, "hipótese");
      assert.strictEqual(rel.id, `${rel.relation_type.toLowerCase()}:${rel.from_record}->${rel.to_record}`);
    }
  });

  test("adapterProfile documents record and relation natural keys", () => {
    const { adapterProfile } = adaptExplorer(input);
    const recordTypes = adapterProfile.recordTypes;
    for (const t of ["Service", "Endpoint", "Flow", "Event", "Table"]) {
      assert.ok(recordTypes[t], `missing record type ${t}`);
      assert.ok(
        typeof recordTypes[t].naturalKey === "string" && recordTypes[t].naturalKey.length > 0,
      );
    }
    const relationTypes = adapterProfile.relationTypes;
    for (const t of ["EXPOSES", "TRIGGERS", "PUBLISHES", "CONSUMES", "PERSISTS_TO"]) {
      assert.ok(relationTypes[t], `missing relation type ${t}`);
      assert.ok(
        typeof relationTypes[t].description === "string" &&
          relationTypes[t].description.length > 0,
      );
    }
  });

  test("does not emit factual records from overview prose", () => {
    const { records } = adaptExplorer(input);
    for (const rec of records) {
      for (const e of rec.evidence) {
        if (e.kind === "artifact") {
          assert.notStrictEqual(e.artifact_path, ".claude/explorer/overview.md");
        }
      }
    }
  });
});
