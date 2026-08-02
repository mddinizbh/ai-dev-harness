import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Seam under test (pre-agreed, ADR 0002 + repo-reference.md): pure construction
// of Repository References (repo:// URI), Artifact References (discriminated
// object), and inclusive 1-based line-range verification against source bytes.
// Module does not exist yet — this import MUST fail first (RED), then pass.
import {
  parsePathLine,
  parseRepositoryReference,
  repositoryReference,
  artifactReference,
  verifyLineRange,
  ProvenanceError,
} from "../src/provenance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE_FIXTURE = readFileSync(
  join(here, "..", "fixtures", "source", "domains", "iam", "controller", "service_register.go"),
  "utf8",
);

describe("parsePathLine", () => {
  test("parses path:singleLine into path with equal start and end bounds", () => {
    // Given a Native Artifact call-site notation path:line
    // When parsed
    // Then path is split from the last ':' and start/end are equal
    assert.deepStrictEqual(
      parsePathLine("domains/iam/controller/service_register.go:60"),
      { path: "domains/iam/controller/service_register.go", startLine: 60, endLine: 60 },
    );
  });

  test("parses explicit path:start-end into distinct bounds", () => {
    // Given a path:start-end notation
    // When parsed
    // Then start and end are read independently
    assert.deepStrictEqual(
      parsePathLine("domains/iam/controller/service_register.go:60-63"),
      { path: "domains/iam/controller/service_register.go", startLine: 60, endLine: 63 },
    );
  });
});

describe("repositoryReference", () => {
  test("produces the exact repo:// URI for the nori-cloud pilot anchor", () => {
    // Given normalized logical repo, pinned revision, path, and 1-based range
    // When the URI is constructed
    // Then it matches the grammar repo://<logical>@<revision>/<path>#L<start>-L<end>
    assert.strictEqual(
      repositoryReference({
        logicalRepo: "nori-cloud",
        sourceRevision: "633d3a5d16c165073ede2b2248bae708483f2efe",
        path: "domains/iam/controller/service_register.go",
        startLine: 60,
        endLine: 60,
      }),
      "repo://nori-cloud@633d3a5d16c165073ede2b2248bae708483f2efe/domains/iam/controller/service_register.go#L60-L60",
    );
  });
});

describe("parseRepositoryReference", () => {
  test("parses a valid repo:// URI into its logical components", () => {
    // Given a normalized Repository Reference URI (single-line anchor)
    // When parsed
    // Then it returns logicalRepo/sourceRevision/path/startLine/endLine per grammar
    assert.deepStrictEqual(
      parseRepositoryReference(
        "repo://nori-cloud@633d3a5d16c165073ede2b2248bae708483f2efe/domains/iam/controller/service_register.go#L113-L113",
      ),
      {
        logicalRepo: "nori-cloud",
        sourceRevision: "633d3a5d16c165073ede2b2248bae708483f2efe",
        path: "domains/iam/controller/service_register.go",
        startLine: 113,
        endLine: 113,
      },
    );
  });

  test("parses a tag-style revision with a multi-line range", () => {
    // Given a non-hex logical revision (any VCS revision string is allowed)
    // When parsed
    // Then revision and inclusive range are read verbatim
    assert.deepStrictEqual(
      parseRepositoryReference(
        "repo://billing-api@v1.4.2/src/main/java/com/example/ChargeService.java#L40-L88",
      ),
      {
        logicalRepo: "billing-api",
        sourceRevision: "v1.4.2",
        path: "src/main/java/com/example/ChargeService.java",
        startLine: 40,
        endLine: 88,
      },
    );
  });

  test("round-trips repositoryReference output back to constructor inputs (single line)", () => {
    // Given a URI built by repositoryReference
    // When parsed
    // Then the parsed object deep-equals the original constructor args
    const args = {
      logicalRepo: "nori-cloud",
      sourceRevision: "633d3a5d16c165073ede2b2248bae708483f2efe",
      path: "domains/iam/controller/service_register.go",
      startLine: 60,
      endLine: 60,
    };
    assert.deepStrictEqual(parseRepositoryReference(repositoryReference(args)), args);
  });

  test("round-trips repositoryReference output back to constructor inputs (multi-line range)", () => {
    // Given a multi-line URI with a dotted revision
    // When round-tripped through repositoryReference -> parseRepositoryReference
    // Then inputs are preserved exactly
    const args = {
      logicalRepo: "platform-tf",
      sourceRevision: "plan-2026.03",
      path: "modules/network/main.tf",
      startLine: 1,
      endLine: 25,
    };
    assert.deepStrictEqual(parseRepositoryReference(repositoryReference(args)), args);
  });
});

describe("artifactReference", () => {
  test("returns the exact discriminated artifact evidence object", () => {
    // Given manifest id, artifact relative path, content sha256 and range
    // When the artifact reference is constructed
    // Then it matches the schema shape {kind, manifest_id, artifact_path, content_sha256, range}
    const sha = "a".repeat(64);
    assert.deepStrictEqual(
      artifactReference({
        manifestId: "manifest:test",
        artifactPath: ".claude/explorer/producers.md",
        contentSha256: sha,
        startLine: 10,
        endLine: 10,
      }),
      {
        kind: "artifact",
        manifest_id: "manifest:test",
        artifact_path: ".claude/explorer/producers.md",
        content_sha256: sha,
        range: { start_line: 10, end_line: 10 },
      },
    );
  });
});

describe("verifyLineRange", () => {
  test("accepts an in-bounds single line on the synthetic 64-line fixture", () => {
    // Given the 64-line synthetic source fixture
    // When verifying line 60..60
    // Then it is true
    assert.strictEqual(verifyLineRange(SOURCE_FIXTURE, 60, 60), true);
  });

  test("accepts an in-bounds multi-line range ending on the last line", () => {
    // Given the 64-line fixture
    // When verifying 1..64
    // Then it is true
    assert.strictEqual(verifyLineRange(SOURCE_FIXTURE, 1, 64), true);
  });

  test("rejects an out-of-bounds end past the last line", () => {
    // Given the 64-line fixture
    // When verifying 60..70
    // Then it is false
    assert.strictEqual(verifyLineRange(SOURCE_FIXTURE, 60, 70), false);
  });

  test("rejects line 0 as a start bound", () => {
    // Given the 64-line fixture
    // When verifying 0..0
    // Then it is false (lines are 1-based)
    assert.strictEqual(verifyLineRange(SOURCE_FIXTURE, 0, 0), false);
  });
});

describe("rejection — ProvenanceError", () => {
  const baseRepoArgs = {
    logicalRepo: "nori-cloud",
    sourceRevision: "633d3a5d16c165073ede2b2248bae708483f2efe",
    path: "domains/iam/controller/service_register.go",
    startLine: 60,
    endLine: 60,
  };
  const baseArtifactArgs = {
    manifestId: "manifest:test",
    artifactPath: ".claude/explorer/producers.md",
    contentSha256: "a".repeat(64),
    startLine: 10,
    endLine: 10,
  };

  test("parsePathLine rejects '..' traversal segment", () => {
    assert.throws(() => parsePathLine("../secret.go:1"), ProvenanceError);
  });

  test("parsePathLine rejects '.' traversal segment", () => {
    assert.throws(() => parsePathLine("./x.go:1"), ProvenanceError);
  });

  test("parsePathLine rejects leading slash (absolute-style path)", () => {
    assert.throws(() => parsePathLine("/domains/x.go:1"), ProvenanceError);
  });

  test("parsePathLine rejects backslash in path", () => {
    assert.throws(() => parsePathLine("domains\\x.go:1"), ProvenanceError);
  });

  test("parsePathLine rejects whitespace in path", () => {
    assert.throws(() => parsePathLine("domains/x y.go:1"), ProvenanceError);
  });

  test("parsePathLine rejects reserved '%' (percent-encoding forbidden in v1)", () => {
    assert.throws(() => parsePathLine("domains/x%20y.go:1"), ProvenanceError);
  });

  test("parsePathLine rejects reserved '?'", () => {
    assert.throws(() => parsePathLine("domains/x?y.go:1"), ProvenanceError);
  });

  test("parsePathLine rejects reserved '#'", () => {
    assert.throws(() => parsePathLine("domains/x#y.go:1"), ProvenanceError);
  });

  test("parsePathLine rejects NUL byte in path", () => {
    assert.throws(() => parsePathLine(`domains/x\x00y.go:1`), ProvenanceError);
  });

  test("parsePathLine rejects malformed path:line without ':line' suffix", () => {
    assert.throws(() => parsePathLine("domains/x.go"), ProvenanceError);
  });

  test("parsePathLine rejects malformed line token", () => {
    assert.throws(() => parsePathLine("domains/x.go:abc"), ProvenanceError);
  });

  test("parsePathLine rejects empty line range after ':'", () => {
    assert.throws(() => parsePathLine("domains/x.go:"), ProvenanceError);
  });

  test("parsePathLine rejects end < start in path:start-end", () => {
    assert.throws(() => parsePathLine("domains/x.go:63-60"), ProvenanceError);
  });

  test("parsePathLine rejects line 0", () => {
    assert.throws(() => parsePathLine("domains/x.go:0"), ProvenanceError);
  });

  test("repositoryReference rejects empty logical repo", () => {
    assert.throws(
      () => repositoryReference({ ...baseRepoArgs, logicalRepo: "" }),
      ProvenanceError,
    );
  });

  test("repositoryReference rejects logical repo containing '/' (display form, not single token)", () => {
    assert.throws(
      () => repositoryReference({ ...baseRepoArgs, logicalRepo: "nori/cloud" }),
      ProvenanceError,
    );
  });

  test("repositoryReference rejects empty source revision", () => {
    assert.throws(
      () => repositoryReference({ ...baseRepoArgs, sourceRevision: "" }),
      ProvenanceError,
    );
  });

  test("repositoryReference rejects end < start", () => {
    assert.throws(
      () => repositoryReference({ ...baseRepoArgs, startLine: 10, endLine: 5 }),
      ProvenanceError,
    );
  });

  test("repositoryReference rejects line 0", () => {
    assert.throws(
      () => repositoryReference({ ...baseRepoArgs, startLine: 0, endLine: 0 }),
      ProvenanceError,
    );
  });

  test("parseRepositoryReference rejects non-string input", () => {
    assert.throws(() => parseRepositoryReference(123), ProvenanceError);
  });

  test("parseRepositoryReference rejects wrong scheme (file://)", () => {
    assert.throws(() => parseRepositoryReference("file:///Users/me/proj/x.go"), ProvenanceError);
  });

  test("parseRepositoryReference rejects machine path (no scheme)", () => {
    assert.throws(() => parseRepositoryReference("/Users/me/proj/x.go"), ProvenanceError);
  });

  test("parseRepositoryReference rejects missing '@<revision>'", () => {
    assert.throws(
      () => parseRepositoryReference("repo://nori-cloud/domains/x.go#L1-L1"),
      ProvenanceError,
    );
  });

  test("parseRepositoryReference rejects missing '#Lx-Ly' fragment", () => {
    assert.throws(
      () => parseRepositoryReference("repo://nori-cloud@abc/domains/x.go"),
      ProvenanceError,
    );
  });

  test("parseRepositoryReference rejects missing '/<path>' after revision", () => {
    assert.throws(
      () => parseRepositoryReference("repo://nori-cloud@abc#L1-L1"),
      ProvenanceError,
    );
  });

  test("parseRepositoryReference rejects incomplete fragment '#L1-'", () => {
    assert.throws(
      () => parseRepositoryReference("repo://nori-cloud@abc/x.go#L1-"),
      ProvenanceError,
    );
  });

  test("parseRepositoryReference rejects fragment missing 'L' prefix", () => {
    assert.throws(
      () => parseRepositoryReference("repo://nori-cloud@abc/x.go#1-2"),
      ProvenanceError,
    );
  });

  test("parseRepositoryReference rejects line 0 in fragment", () => {
    assert.throws(
      () => parseRepositoryReference("repo://nori-cloud@abc/x.go#L0-L1"),
      ProvenanceError,
    );
  });

  test("parseRepositoryReference rejects end < start in fragment", () => {
    assert.throws(
      () => parseRepositoryReference("repo://nori-cloud@abc/x.go#L10-L9"),
      ProvenanceError,
    );
  });

  test("parseRepositoryReference rejects '..' traversal segment", () => {
    assert.throws(
      () => parseRepositoryReference("repo://nori-cloud@abc/../secret.go#L1-L1"),
      ProvenanceError,
    );
  });

  test("parseRepositoryReference rejects reserved '%' in path", () => {
    assert.throws(
      () => parseRepositoryReference("repo://nori-cloud@abc/x%20y.go#L1-L1"),
      ProvenanceError,
    );
  });

  test("parseRepositoryReference rejects reserved '@' in path", () => {
    assert.throws(
      () => parseRepositoryReference("repo://nori-cloud@abc/foo@bar.go#L1-L1"),
      ProvenanceError,
    );
  });

  test("parseRepositoryReference rejects empty logical identity", () => {
    assert.throws(
      () => parseRepositoryReference("repo://@abc/x.go#L1-L1"),
      ProvenanceError,
    );
  });

  test("parseRepositoryReference rejects empty revision", () => {
    assert.throws(
      () => parseRepositoryReference("repo://nori-cloud@/x.go#L1-L1"),
      ProvenanceError,
    );
  });

  test("parseRepositoryReference rejects whitespace in logical identity", () => {
    assert.throws(
      () => parseRepositoryReference("repo://no ri@abc/x.go#L1-L1"),
      ProvenanceError,
    );
  });

  test("parseRepositoryReference rejects absolute-style path (empty segment)", () => {
    assert.throws(
      () => parseRepositoryReference("repo://nori-cloud@abc//x.go#L1-L1"),
      ProvenanceError,
    );
  });

  test("artifactReference rejects invalid (non hex-64) SHA-256", () => {
    assert.throws(
      () => artifactReference({ ...baseArtifactArgs, contentSha256: "short" }),
      ProvenanceError,
    );
  });

  test("artifactReference rejects uppercase hex SHA-256 (lowercase only)", () => {
    assert.throws(
      () => artifactReference({ ...baseArtifactArgs, contentSha256: "A".repeat(64) }),
      ProvenanceError,
    );
  });

  test("artifactReference rejects end < start", () => {
    assert.throws(
      () => artifactReference({ ...baseArtifactArgs, startLine: 20, endLine: 10 }),
      ProvenanceError,
    );
  });
});
