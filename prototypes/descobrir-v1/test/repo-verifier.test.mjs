import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Seam under test (pre-agreed, ADR 0002 §"Regras de status da fonte" +
// repo-reference.md): repository-evidence verifier + hipótese→comprovado
// promotion. Reuses parseRepositoryReference + verifyLineRange from
// provenance.mjs. Reader is injected so no live git is touched here.
// Module does not exist yet — this import MUST fail first (RED), then pass.
import { RepoVerifierError, verifyAndPromote } from "../src/repo-verifier.mjs";
import { ProvenanceError } from "../src/provenance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE_FIXTURE = readFileSync(
  join(here, "..", "fixtures", "source", "domains", "iam", "controller", "service_register.go"),
  "utf8",
);

const REPO = "nori-cloud";
const REV = "633d3a5d16c165073ede2b2248bae708483f2efe";
const PATH = "domains/iam/controller/service_register.go";

function repoUri({ repo = REPO, rev = REV, path = PATH, start = 60, end = 60 } = {}) {
  return `repo://${repo}@${rev}/${path}#L${start}-L${end}`;
}

function repoEvidence(uri = repoUri()) {
  return { kind: "repository", uri };
}

function artifactEvidence() {
  return {
    kind: "artifact",
    manifest_id: "manifest:test",
    artifact_path: ".claude/explorer/endpoints.md",
    content_sha256: "a".repeat(64),
    range: { start_line: 1, end_line: 1 },
  };
}

function record({
  id = "service:iam",
  status = "hipótese",
  evidence = [artifactEvidence(), repoEvidence()],
  attributes = { domain: "iam" },
} = {}) {
  return {
    id,
    namespace: "nori",
    type: "Service",
    name: id,
    summary: `service ${id}`,
    attributes: { ...attributes },
    status,
    source_revision: REV,
    source_engine: {
      name: "explorer",
      profile: "go-api",
      adapter_version: "0.1.0",
      artifact_manifest_id: "manifest:test",
    },
    evidence: evidence.map((e) => ({ ...e, ...(e.range ? { range: { ...e.range } } : {}) })),
  };
}

function relation({
  id = "exposes:service:iam->endpoint:register",
  status = "hipótese",
  evidence = [artifactEvidence(), repoEvidence()],
} = {}) {
  return {
    id,
    namespace: "nori",
    from_record: "service:iam",
    relation_type: "EXPOSES",
    to_record: "endpoint:register",
    status,
    source_revision: REV,
    source_engine: {
      name: "explorer",
      profile: "go-api",
      adapter_version: "0.1.0",
      artifact_manifest_id: "manifest:test",
    },
    evidence: evidence.map((e) => ({ ...e, ...(e.range ? { range: { ...e.range } } : {}) })),
  };
}

// Fake readers — synchronous, take ({revision, path}), return Buffer|string.
function readerReturning(bytes) {
  return ({ revision: _r, path: _p }) => bytes;
}
function readerThrowing(err) {
  return ({ revision: _r, path: _p }) => {
    throw err;
  };
}
function recordingReader(bytes, log) {
  return ({ revision, path }) => {
    log.push({ revision, path });
    return bytes;
  };
}

// --- Promotion (hipótese → comprovado) -------------------------------------

describe("verifyAndPromote — promotion to comprovado", () => {
  test("promotes a hipótese record with one verifying repository evidence", () => {
    // Given a hipótese record whose repo URI is in-bounds on the fixture
    const rec = record();
    // When verified against the matching logical repo + revision + reader
    const out = verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then the record is promoted to comprovado and not flagged unresolved
    assert.strictEqual(out.records[0].status, "comprovado");
    assert.deepStrictEqual(out.unresolvedIds, []);
  });

  test("preserves artifact evidence and all other fields on promotion", () => {
    // Given a record with both artifact and repository evidence
    const original = record();
    // When promoted
    const out = verifyAndPromote({
      records: [original],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then every non-status field is preserved exactly, including evidence list
    const promoted = out.records[0];
    assert.strictEqual(promoted.id, original.id);
    assert.strictEqual(promoted.namespace, original.namespace);
    assert.strictEqual(promoted.type, original.type);
    assert.strictEqual(promoted.name, original.name);
    assert.strictEqual(promoted.summary, original.summary);
    assert.deepStrictEqual(promoted.attributes, original.attributes);
    assert.strictEqual(promoted.source_revision, original.source_revision);
    assert.deepStrictEqual(promoted.source_engine, original.source_engine);
    assert.deepStrictEqual(promoted.evidence, original.evidence);
    assert.strictEqual(promoted.evidence.length, 2);
    assert.deepStrictEqual(promoted.evidence[0], artifactEvidence());
  });

  test("promotes when multiple repository evidences all verify", () => {
    // Given a record with two distinct in-bounds repo URIs (L60-L60 and L1-L1)
    const rec = record({
      evidence: [
        artifactEvidence(),
        repoEvidence(repoUri({ start: 60, end: 60 })),
        repoEvidence(repoUri({ start: 1, end: 1 })),
      ],
    });
    // When verified
    const out = verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then both verified and status is comprovado
    assert.strictEqual(out.records[0].status, "comprovado");
    assert.deepStrictEqual(out.unresolvedIds, []);
  });

  test("promotes a hipótese relation with verifying repository evidence", () => {
    // Given a hipótese relation with a verifying repo URI
    const rel = relation();
    // When verified
    const out = verifyAndPromote({
      records: [],
      relations: [rel],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then the relation is promoted
    assert.strictEqual(out.relations[0].status, "comprovado");
    assert.deepStrictEqual(out.unresolvedIds, []);
  });

  test("accepts a reader that returns a Buffer (git show shape)", () => {
    // Given a reader returning committed bytes as a Buffer
    const rec = record();
    // When verified
    const out = verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(Buffer.from(SOURCE_FIXTURE, "utf8")),
    });
    // Then promotion happens (Buffer is decoded to utf8 for line counting)
    assert.strictEqual(out.records[0].status, "comprovado");
  });

  test("accepts a reader that returns a string", () => {
    // Given a reader returning a plain string
    const rec = record();
    // When verified
    const out = verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then promotion happens
    assert.strictEqual(out.records[0].status, "comprovado");
  });

  test("passes pinned revision and parsed path to the reader", () => {
    // Given a spy reader
    const rec = record();
    const log = [];
    // When verified
    verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: recordingReader(SOURCE_FIXTURE, log),
    });
    // Then the reader receives the parsed revision + path, never the raw URI
    assert.deepStrictEqual(log, [{ revision: REV, path: PATH }]);
  });

  test("uses the existing source fixture for a known-good anchor (L60-L60)", () => {
    // Given the same 64-line synthetic fixture used by provenance tests
    // When verifying the L60-L60 anchor that provenance marks in-bounds
    const rec = record({
      evidence: [artifactEvidence(), repoEvidence(repoUri({ start: 60, end: 60 }))],
    });
    const out = verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then it promotes (cross-checks verifyLineRange contract)
    assert.strictEqual(out.records[0].status, "comprovado");
  });
});

// --- No-promotion (stays hipótese + unresolved) ----------------------------

describe("verifyAndPromote — no promotion, entity unresolved", () => {
  test("rejects malformed repository URI and flags unresolved", () => {
    // Given a hipótese record with a structurally invalid repo URI
    const rec = record({ evidence: [artifactEvidence(), repoEvidence("repo://broken-no-at/x#L1-L1")] });
    // When verified
    const out = verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then status stays hipótese and the id is unresolved
    assert.strictEqual(out.records[0].status, "hipótese");
    assert.deepStrictEqual(out.unresolvedIds, [rec.id]);
  });

  test("rejects logical repo mismatch and flags unresolved", () => {
    // Given a URI whose logical repo differs from the verifier's logicalRepo
    const rec = record({
      evidence: [artifactEvidence(), repoEvidence(repoUri({ repo: "other-cloud" }))],
    });
    // When verified against nori-cloud
    const out = verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then it stays hipótese + unresolved
    assert.strictEqual(out.records[0].status, "hipótese");
    assert.deepStrictEqual(out.unresolvedIds, [rec.id]);
  });

  test("rejects source revision mismatch and flags unresolved", () => {
    // Given a URI whose revision differs from the verifier's sourceRevision
    const rec = record({
      evidence: [artifactEvidence(), repoEvidence(repoUri({ rev: "deadbeef" }))],
    });
    // When verified against the pinned revision
    const out = verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then it stays hipótese + unresolved
    assert.strictEqual(out.records[0].status, "hipótese");
    assert.deepStrictEqual(out.unresolvedIds, [rec.id]);
  });

  test("propagates an unexpected generic reader error instead of hiding a bug", () => {
    const rec = record();
    assert.throws(
      () =>
        verifyAndPromote({
          records: [rec],
          relations: [],
          logicalRepo: REPO,
          sourceRevision: REV,
          readAtRevision: readerThrowing(new Error("unexpected reader failure")),
        }),
      /unexpected reader failure/,
    );
  });

  test("treats a typed reader error (GitSourceError-like) as unresolved", () => {
    // Given a reader that throws a typed error (production shape)
    class GitSourceError extends Error {
      constructor(m) {
        super(m);
        this.name = "GitSourceError";
      }
    }
    const rec = record();
    // When verified
    const out = verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerThrowing(new GitSourceError("git show failed")),
    });
    // Then unresolved (typed reader failures are expected, not programmer errors)
    assert.strictEqual(out.records[0].status, "hipótese");
    assert.deepStrictEqual(out.unresolvedIds, [rec.id]);
  });

  test("rejects an out-of-bounds line range against the reader bytes", () => {
    // Given a URI whose end_line exceeds the 64-line fixture
    const rec = record({
      evidence: [artifactEvidence(), repoEvidence(repoUri({ start: 60, end: 70 }))],
    });
    // When verified
    const out = verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then it stays hipótese + unresolved
    assert.strictEqual(out.records[0].status, "hipótese");
    assert.deepStrictEqual(out.unresolvedIds, [rec.id]);
  });

  test("rejects when one of multiple repo evidences fails", () => {
    // Given a record with one good and one out-of-bounds repo URI
    const rec = record({
      evidence: [
        artifactEvidence(),
        repoEvidence(repoUri({ start: 60, end: 60 })),
        repoEvidence(repoUri({ start: 1, end: 999 })),
      ],
    });
    // When verified
    const out = verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then the failing evidence blocks promotion; entity is unresolved
    assert.strictEqual(out.records[0].status, "hipótese");
    assert.deepStrictEqual(out.unresolvedIds, [rec.id]);
  });

  test("does not call the reader when the URI is malformed", () => {
    // Given a malformed URI and a spy reader
    const log = [];
    const rec = record({ evidence: [artifactEvidence(), repoEvidence("not-a-uri")] });
    // When verified
    verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: recordingReader(SOURCE_FIXTURE, log),
    });
    // Then the reader is never invoked (parse fails first)
    assert.deepStrictEqual(log, []);
  });

  test("does not call the reader when repo or revision mismatches", () => {
    // Given a URI with a wrong repo and a spy reader
    const log = [];
    const rec = record({
      evidence: [artifactEvidence(), repoEvidence(repoUri({ repo: "other-cloud" }))],
    });
    // When verified
    verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: recordingReader(SOURCE_FIXTURE, log),
    });
    // Then the reader is never invoked (mismatch short-circuits)
    assert.deepStrictEqual(log, []);
  });
});

// --- Artifact-only entities stay hipótese, never unresolved ----------------

describe("verifyAndPromote — artifact-only stays hipótese, not unresolved", () => {
  test("artifact-only record remains hipótese and is NOT unresolved", () => {
    // Given a hipótese record with only artifact evidence
    const rec = record({ evidence: [artifactEvidence()] });
    // When verified
    const out = verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then status is unchanged and unresolvedIds is empty
    assert.strictEqual(out.records[0].status, "hipótese");
    assert.deepStrictEqual(out.unresolvedIds, []);
  });

  test("artifact-only relation remains hipótese and is NOT unresolved", () => {
    // Given a hipótese relation with only artifact evidence
    const rel = relation({ evidence: [artifactEvidence()] });
    // When verified
    const out = verifyAndPromote({
      records: [],
      relations: [rel],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then status is unchanged
    assert.strictEqual(out.relations[0].status, "hipótese");
    assert.deepStrictEqual(out.unresolvedIds, []);
  });

  test("does not call the reader for artifact-only entities", () => {
    // Given an artifact-only record and a spy reader
    const log = [];
    const rec = record({ evidence: [artifactEvidence()] });
    // When verified
    verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: recordingReader(SOURCE_FIXTURE, log),
    });
    // Then no reader call happens (no repo evidence to verify)
    assert.deepStrictEqual(log, []);
  });
});

// --- Pass-through statuses (contradição, stale, comprovado) ----------------

describe("verifyAndPromote — non-hipótese statuses unchanged", () => {
  test("contradição status is preserved even with failing repo evidence", () => {
    // Given a contradição record with an out-of-bounds repo URI
    const rec = record({
      status: "contradição",
      evidence: [artifactEvidence(), repoEvidence(repoUri({ start: 60, end: 999 }))],
    });
    // When verified
    const out = verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then status stays contradição and is NOT promoted NOR unresolved
    assert.strictEqual(out.records[0].status, "contradição");
    assert.deepStrictEqual(out.unresolvedIds, []);
  });

  test("stale status is preserved", () => {
    // Given a stale record
    const rec = record({ status: "stale" });
    // When verified
    const out = verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then status stays stale and is NOT promoted NOR unresolved
    assert.strictEqual(out.records[0].status, "stale");
    assert.deepStrictEqual(out.unresolvedIds, []);
  });

  test("already-comprovado status is preserved (not re-verified, not unresolved)", () => {
    // Given a comprovado record with a broken URI (would fail if re-checked)
    const rec = record({
      status: "comprovado",
      evidence: [artifactEvidence(), repoEvidence(repoUri({ start: 99, end: 999 }))],
    });
    const log = [];
    // When verified
    const out = verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: recordingReader(SOURCE_FIXTURE, log),
    });
    // Then status stays comprovado and reader is never called
    assert.strictEqual(out.records[0].status, "comprovado");
    assert.deepStrictEqual(out.unresolvedIds, []);
    assert.deepStrictEqual(log, []);
  });
});

// --- Immutability ----------------------------------------------------------

describe("verifyAndPromote — never mutates inputs", () => {
  test("does not mutate the input records array or its record objects", () => {
    // Given a hipótese record
    const rec = record();
    const snapshot = JSON.parse(JSON.stringify(rec));
    const recordsRef = [rec];
    const recordsArrSnapshot = [...recordsRef];
    // When verified
    verifyAndPromote({
      records: recordsRef,
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then the input record is byte-identical to its pre-call snapshot
    assert.deepStrictEqual(rec, snapshot);
    assert.deepStrictEqual(recordsRef, recordsArrSnapshot);
    assert.strictEqual(recordsRef[0], rec);
  });

  test("does not mutate input evidence arrays or items", () => {
    // Given a record built directly (no helper cloning) so reference identity
    // is observable on the input side
    const evItem = repoEvidence();
    const artItem = artifactEvidence();
    const rec = {
      id: "service:iam",
      namespace: "nori",
      type: "Service",
      name: "service:iam",
      summary: "service iam",
      attributes: { domain: "iam" },
      status: "hipótese",
      source_revision: REV,
      source_engine: {
        name: "explorer",
        profile: "go-api",
        adapter_version: "0.1.0",
        artifact_manifest_id: "manifest:test",
      },
      evidence: [artItem, evItem],
    };
    const evSnapshot = { ...evItem };
    const artSnapshot = { ...artItem, range: { ...artItem.range } };
    const evidenceArrSnapshot = [...rec.evidence];
    // When verified
    verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then the shared evidence array and item objects are unchanged
    assert.strictEqual(rec.evidence[0], artItem);
    assert.strictEqual(rec.evidence[1], evItem);
    assert.deepStrictEqual(rec.evidence, evidenceArrSnapshot);
    assert.deepStrictEqual(evItem, evSnapshot);
    assert.deepStrictEqual(artItem, artSnapshot);
  });

  test("returns fresh record objects (not the input references)", () => {
    // Given an input record
    const rec = record();
    // When verified
    const out = verifyAndPromote({
      records: [rec],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then the output record is a different object and a different evidence array
    assert.notStrictEqual(out.records[0], rec);
    assert.notStrictEqual(out.records[0].evidence, rec.evidence);
  });
});

// --- Output structure (sorted, deterministic) ------------------------------

describe("verifyAndPromote — output structure", () => {
  test("sorts output records by id", () => {
    // Given records inserted out of id order
    const a = record({ id: "service:zeta", evidence: [artifactEvidence()] });
    const b = record({ id: "service:alpha", evidence: [artifactEvidence()] });
    // When verified
    const out = verifyAndPromote({
      records: [a, b],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then output is sorted ascending by id
    assert.deepStrictEqual(out.records.map((r) => r.id), ["service:alpha", "service:zeta"]);
  });

  test("sorts output relations by id", () => {
    // Given relations inserted out of id order
    const r1 = relation({ id: "exposes:b->y", evidence: [artifactEvidence()] });
    const r2 = relation({ id: "exposes:a->x", evidence: [artifactEvidence()] });
    // When verified
    const out = verifyAndPromote({
      records: [],
      relations: [r1, r2],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then output is sorted
    assert.deepStrictEqual(out.relations.map((r) => r.id), ["exposes:a->x", "exposes:b->y"]);
  });

  test("unresolvedIds is sorted by id (code-unit order)", () => {
    // Given two unresolved records inserted out of id order
    const a = record({ id: "service:zzz", evidence: [artifactEvidence(), repoEvidence("bad-uri")] });
    const b = record({ id: "service:aaa", evidence: [artifactEvidence(), repoEvidence("bad-uri")] });
    // When verified
    const out = verifyAndPromote({
      records: [a, b],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then unresolvedIds is sorted, not insertion-ordered
    assert.deepStrictEqual(out.unresolvedIds, ["service:aaa", "service:zzz"]);
  });

  test("unresolvedIds is deterministic across calls with identical inputs", () => {
    // Given the same inputs materialized twice
    const mk = () => [
      record({ id: "service:a", evidence: [artifactEvidence(), repoEvidence("bad")] }),
      record({ id: "service:b", evidence: [artifactEvidence(), repoEvidence(repoUri({ repo: "x" }))] }),
    ];
    // When verified twice
    const out1 = verifyAndPromote({
      records: mk(),
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    const out2 = verifyAndPromote({
      records: mk(),
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then outputs are deep-equal (records, relations, unresolvedIds)
    assert.deepStrictEqual(out1, out2);
  });

  test("mixed batch: one promotes, one unresolved, one artifact-only", () => {
    // Given a batch with three different outcomes
    const promoted = record({ id: "service:ok", evidence: [artifactEvidence(), repoEvidence()] });
    const unresolved = record({
      id: "service:bad",
      evidence: [artifactEvidence(), repoEvidence(repoUri({ repo: "other" }))],
    });
    const artifactOnly = record({ id: "service:art", evidence: [artifactEvidence()] });
    // When verified
    const out = verifyAndPromote({
      records: [promoted, unresolved, artifactOnly],
      relations: [],
      logicalRepo: REPO,
      sourceRevision: REV,
      readAtRevision: readerReturning(SOURCE_FIXTURE),
    });
    // Then statuses and unresolvedIds reflect each outcome independently
    const byId = new Map(out.records.map((r) => [r.id, r.status]));
    assert.strictEqual(byId.get("service:ok"), "comprovado");
    assert.strictEqual(byId.get("service:bad"), "hipótese");
    assert.strictEqual(byId.get("service:art"), "hipótese");
    assert.deepStrictEqual(out.unresolvedIds, ["service:bad"]);
  });
});

// --- Programmer errors are NEVER swallowed ---------------------------------

describe("verifyAndPromote — programmer errors propagate (no swallow)", () => {
  test("TypeError from the reader is rethrown, not treated as unresolved", () => {
    // Given a reader that throws a TypeError (programmer bug)
    const rec = record();
    // When verified
    // Then the TypeError propagates and the entity is NOT silently unresolved
    assert.throws(
      () =>
        verifyAndPromote({
          records: [rec],
          relations: [],
          logicalRepo: REPO,
          sourceRevision: REV,
          readAtRevision: readerThrowing(new TypeError("reader is broken")),
        }),
      TypeError,
    );
  });

  test("ReferenceError from the reader is rethrown", () => {
    // Given a reader that throws a ReferenceError
    const rec = record();
    // When verified
    // Then it propagates
    assert.throws(
      () =>
        verifyAndPromote({
          records: [rec],
          relations: [],
          logicalRepo: REPO,
          sourceRevision: REV,
          readAtRevision: readerThrowing(new ReferenceError("undefined var")),
        }),
      ReferenceError,
    );
  });

  test("non-Error throw from the reader is rethrown (not silently unresolved)", () => {
    // Given a reader that throws a non-Error value
    const rec = record();
    // When verified
    // Then the value propagates (only Error instances with non-programmer names
    // are treated as expected reader failures)
    assert.throws(
      () =>
        verifyAndPromote({
          records: [rec],
          relations: [],
          logicalRepo: REPO,
          sourceRevision: REV,
          readAtRevision: readerThrowing("a plain string"),
        }),
      (err) => err === "a plain string",
    );
  });
});

// --- Top-level input validation → RepoVerifierError ------------------------

describe("verifyAndPromote — top-level validation", () => {
  const okReader = readerReturning(SOURCE_FIXTURE);
  const base = { records: [], relations: [], logicalRepo: REPO, sourceRevision: REV, readAtRevision: okReader };

  test("rejects non-array records with RepoVerifierError", () => {
    assert.throws(() => verifyAndPromote({ ...base, records: {} }), RepoVerifierError);
  });

  test("rejects non-array relations with RepoVerifierError", () => {
    assert.throws(() => verifyAndPromote({ ...base, relations: null }), RepoVerifierError);
  });

  test("rejects empty logicalRepo with RepoVerifierError", () => {
    assert.throws(() => verifyAndPromote({ ...base, logicalRepo: "" }), RepoVerifierError);
  });

  test("rejects non-string logicalRepo with RepoVerifierError", () => {
    assert.throws(() => verifyAndPromote({ ...base, logicalRepo: 42 }), RepoVerifierError);
  });

  test("rejects empty sourceRevision with RepoVerifierError", () => {
    assert.throws(() => verifyAndPromote({ ...base, sourceRevision: "" }), RepoVerifierError);
  });

  test("rejects non-function readAtRevision with RepoVerifierError", () => {
    assert.throws(() => verifyAndPromote({ ...base, readAtRevision: "not-a-fn" }), RepoVerifierError);
  });

  test("rejects a non-object record with RepoVerifierError", () => {
    assert.throws(
      () => verifyAndPromote({ ...base, records: ["not-an-object"] }),
      RepoVerifierError,
    );
  });

  test("RepoVerifierError is a typed Error subclass (instanceof checks)", () => {
    // Given invalid top-level input
    // When caught
    let caught;
    try {
      verifyAndPromote({ ...base, records: null });
    } catch (err) {
      caught = err;
    }
    // Then it is an Error and a RepoVerifierError with the right name
    assert.ok(caught instanceof Error);
    assert.ok(caught instanceof RepoVerifierError);
    assert.strictEqual(caught.name, "RepoVerifierError");
  });

  test("RepoVerifierError never leaks raw source bytes (no SOURCE_FIXTURE in message)", () => {
    // Given an invalid input derived from raw source content
    // When it fails
    let msg;
    try {
      verifyAndPromote({ ...base, records: [{ id: SOURCE_FIXTURE }] });
    } catch (err) {
      msg = err.message;
    }
    // Then the error message does not echo raw fixture bytes
    assert.ok(typeof msg === "string");
    assert.ok(!msg.includes("SYNTHETIC FIXTURE"));
  });
});
