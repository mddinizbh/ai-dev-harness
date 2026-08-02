import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, rmSync as removeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Seam under test (pre-agreed, ADR 0003 §"Verificação de código contra a revisão
// fixada (execução segura)" + repo-reference.md path segment rules):
//   - strict hex revision + safe relative path validation BEFORE spawn
//   - readFileAtRevision via git show <rev>:<path>, argv, shell:false, minimal env,
//     NO fallback to working-tree bytes
//   - porcelain v1 status parsing (path names only, never contents)
//   - repositorySnapshot: anchor_present, tracked_count, dirty_count, dirty_names,
//     deterministic summary_hash
// Module does not exist yet — this import MUST fail first (RED), then pass.
import {
  GitSourceError,
  validateRevision,
  validateRelativePath,
  parsePorcelainStatus,
  readFileAtRevision,
  repositorySnapshot,
} from "../src/git-source.mjs";

// --- Fixture: disposable temp git repo under OS tmpdir (never the harness, never
// the pilot). Code under test uses nulled global/system git config + minimal env;
// fixture setup uses inline -c user config (not the unit under test). ----------

function fixtureGit(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", shell: false }).trim();
}

function makeFixture() {
  const cwd = mkdtempSync(join(tmpdir(), "descobrir-git-src-"));
  fixtureGit(cwd, ["init", "-q", "-b", "main"]);
  writeFileSync(join(cwd, "keep.txt"), "keep-v1\n");
  writeFileSync(join(cwd, "modify.txt"), "modify-v1\n");
  writeFileSync(join(cwd, "remove.txt"), "remove-v1\n");
  fixtureGit(cwd, ["add", "."]);
  fixtureGit(cwd, [
    "-c", "user.email=test@example.com",
    "-c", "user.name=Test",
    "commit", "-q", "-m", "initial",
  ]);
  const head = fixtureGit(cwd, ["rev-parse", "HEAD"]);
  // Dirty working tree (mirrors pilot shape: tracked modification, tracked
  // removal, untracked path). Contents are irrelevant to the snapshot.
  writeFileSync(join(cwd, "modify.txt"), "modify-v2\n");
  removeSync(join(cwd, "remove.txt"));
  writeFileSync(join(cwd, "untracked.txt"), "new\n");
  return { cwd, head };
}

let fixture;
before(() => {
  fixture = makeFixture();
});
after(() => {
  if (fixture) rmSync(fixture.cwd, { recursive: true, force: true });
});

describe("validateRevision", () => {
  test("accepts the pilot anchor (40 lowercase hex)", () => {
    assert.doesNotThrow(() =>
      validateRevision("633d3a5d16c165073ede2b2248bae708483f2efe"));
  });

  test("accepts the shortest abbreviated form (7 hex)", () => {
    assert.doesNotThrow(() => validateRevision("abcdef0"));
  });

  test("accepts the longest SHA-256 form (64 hex)", () => {
    assert.doesNotThrow(() => validateRevision("0".repeat(64)));
  });

  test("rejects fewer than 7 hex chars", () => {
    assert.throws(() => validateRevision("abcdef"), GitSourceError);
  });

  test("rejects more than 64 hex chars", () => {
    assert.throws(() => validateRevision("a".repeat(65)), GitSourceError);
  });

  test("rejects non-hex characters", () => {
    assert.throws(() => validateRevision("g".repeat(7)), GitSourceError);
  });

  test("rejects uppercase hex (strict lowercase)", () => {
    assert.throws(() => validateRevision("ABCDEF0"), GitSourceError);
  });

  test("rejects embedded whitespace", () => {
    assert.throws(() => validateRevision("abcdef0 1234567"), GitSourceError);
  });

  test("rejects empty string and non-strings", () => {
    assert.throws(() => validateRevision(""), GitSourceError);
    assert.throws(() => validateRevision(null), GitSourceError);
    assert.throws(() => validateRevision(1234567), GitSourceError);
  });
});

describe("validateRelativePath", () => {
  test("accepts a nested POSIX relative path", () => {
    assert.doesNotThrow(() =>
      validateRelativePath("domains/iam/controller/service_register.go"));
  });

  test("accepts a single-segment path", () => {
    assert.doesNotThrow(() => validateRelativePath("keep.txt"));
  });

  test("rejects empty and non-strings", () => {
    assert.throws(() => validateRelativePath(""), GitSourceError);
    assert.throws(() => validateRelativePath(null), GitSourceError);
  });

  test("rejects absolute-style leading slash", () => {
    assert.throws(() => validateRelativePath("/etc/passwd"), GitSourceError);
  });

  test("rejects '..' traversal segment", () => {
    assert.throws(() => validateRelativePath("../secret.go"), GitSourceError);
    assert.throws(() => validateRelativePath("a/../b.go"), GitSourceError);
  });

  test("rejects '.' traversal segment", () => {
    assert.throws(() => validateRelativePath("./x.go"), GitSourceError);
    assert.throws(() => validateRelativePath("a/./b.go"), GitSourceError);
  });

  test("rejects empty segment (// or trailing slash)", () => {
    assert.throws(() => validateRelativePath("a//b.go"), GitSourceError);
    assert.throws(() => validateRelativePath("a/"), GitSourceError);
  });

  test("rejects whitespace in segment", () => {
    assert.throws(() => validateRelativePath("a b.go"), GitSourceError);
  });

  test("rejects backslash in segment", () => {
    assert.throws(() => validateRelativePath("a\\b.go"), GitSourceError);
  });

  test("rejects reserved chars % ? # @", () => {
    assert.throws(() => validateRelativePath("a%20b.go"), GitSourceError);
    assert.throws(() => validateRelativePath("a?b.go"), GitSourceError);
    assert.throws(() => validateRelativePath("a#b.go"), GitSourceError);
    assert.throws(() => validateRelativePath("a@b.go"), GitSourceError);
  });

  test("rejects NUL byte", () => {
    assert.throws(() => validateRelativePath("a\x00b.go"), GitSourceError);
  });
});

describe("parsePorcelainStatus", () => {
  test("returns no entries for empty output", () => {
    assert.deepStrictEqual(parsePorcelainStatus(""), []);
  });

  test("parses an unstaged modification (XY=' M')", () => {
    assert.deepStrictEqual(parsePorcelainStatus(" M modify.txt"), [
      { xy: " M", path: "modify.txt", orig_path: null },
    ]);
  });

  test("parses an untracked entry (XY='??')", () => {
    assert.deepStrictEqual(parsePorcelainStatus("?? untracked.txt"), [
      { xy: "??", path: "untracked.txt", orig_path: null },
    ]);
  });

  test("parses a rename (R) into new path with orig_path", () => {
    assert.deepStrictEqual(parsePorcelainStatus("R  old.txt -> new.txt"), [
      { xy: "R ", path: "new.txt", orig_path: "old.txt" },
    ]);
  });

  test("parses a copy (C) into new path with orig_path", () => {
    assert.deepStrictEqual(parsePorcelainStatus("C  old.txt -> new.txt"), [
      { xy: "C ", path: "new.txt", orig_path: "old.txt" },
    ]);
  });

  test("parses a multi-line mix and skips a trailing empty line", () => {
    const out = " M modify.txt\n D remove.txt\n?? untracked.txt\n";
    assert.deepStrictEqual(parsePorcelainStatus(out), [
      { xy: " M", path: "modify.txt", orig_path: null },
      { xy: " D", path: "remove.txt", orig_path: null },
      { xy: "??", path: "untracked.txt", orig_path: null },
    ]);
  });

  test("preserves spaces inside paths after the status field", () => {
    assert.deepStrictEqual(parsePorcelainStatus("?? my file.txt"), [
      { xy: "??", path: "my file.txt", orig_path: null },
    ]);
  });

  test("ignores a malformed line shorter than 4 chars", () => {
    assert.deepStrictEqual(parsePorcelainStatus("XY\n?? ok.txt"), [
      { xy: "??", path: "ok.txt", orig_path: null },
    ]);
  });
});

describe("readFileAtRevision", () => {
  test("returns the committed bytes at the anchor (no working-tree fallback)", () => {
    // Given modify.txt was committed as "modify-v1\n" and dirtied to "modify-v2\n"
    // When reading at HEAD
    // Then the committed bytes are returned, NOT the dirty working-tree bytes
    const buf = readFileAtRevision({
      cwd: fixture.cwd,
      revision: fixture.head,
      path: "modify.txt",
    });
    assert.ok(Buffer.isBuffer(buf));
    assert.strictEqual(buf.toString("utf8"), "modify-v1\n");
  });

  test("returns committed bytes for an untouched tracked file", () => {
    const buf = readFileAtRevision({
      cwd: fixture.cwd,
      revision: fixture.head,
      path: "keep.txt",
    });
    assert.strictEqual(buf.toString("utf8"), "keep-v1\n");
  });

  test("throws GitSourceError when the path does not exist at the revision", () => {
    assert.throws(
      () => readFileAtRevision({ cwd: fixture.cwd, revision: fixture.head, path: "nope.go" }),
      GitSourceError,
    );
  });

  test("throws GitSourceError (before spawn) for an invalid revision", () => {
    assert.throws(
      () => readFileAtRevision({ cwd: fixture.cwd, revision: "bad", path: "keep.txt" }),
      GitSourceError,
    );
  });

  test("throws GitSourceError for an unsafe path", () => {
    assert.throws(
      () => readFileAtRevision({ cwd: fixture.cwd, revision: fixture.head, path: "../x" }),
      GitSourceError,
    );
  });

  test("throws GitSourceError for a non-absolute cwd", () => {
    assert.throws(
      () => readFileAtRevision({ cwd: "relative/dir", revision: fixture.head, path: "keep.txt" }),
      GitSourceError,
    );
  });
});

describe("repositorySnapshot", () => {
  test("reports CoverageReport mutation snapshot field names on the dirty fixture", () => {
    const snap = repositorySnapshot({ cwd: fixture.cwd, anchorRevision: fixture.head });
    assert.strictEqual(snap.anchor_object_present, true);
    assert.strictEqual(snap.tracked_file_count, 3);
    assert.strictEqual(snap.dirty_path_count, 3);
    assert.deepStrictEqual(snap.dirty_names, ["modify.txt", "remove.txt", "untracked.txt"]);
  });

  test("summary_hash is 64 lowercase hex", () => {
    const snap = repositorySnapshot({ cwd: fixture.cwd, anchorRevision: fixture.head });
    assert.match(snap.summary_hash, /^[a-f0-9]{64}$/);
  });

  test("summary_hash is deterministic for the same repo state", () => {
    const a = repositorySnapshot({ cwd: fixture.cwd, anchorRevision: fixture.head });
    const b = repositorySnapshot({ cwd: fixture.cwd, anchorRevision: fixture.head });
    assert.strictEqual(a.summary_hash, b.summary_hash);
  });

  test("anchor_object_present is false for a valid hex revision absent from the repo", () => {
    const snap = repositorySnapshot({
      cwd: fixture.cwd,
      anchorRevision: "0".repeat(40),
    });
    assert.strictEqual(snap.anchor_object_present, false);
    // tracked/dirty still describe the working tree independently of the anchor
    assert.strictEqual(snap.tracked_file_count, 3);
    assert.strictEqual(snap.dirty_path_count, 3);
  });

  test("summary_hash differs between present and absent anchor", () => {
    const present = repositorySnapshot({ cwd: fixture.cwd, anchorRevision: fixture.head });
    const absent = repositorySnapshot({ cwd: fixture.cwd, anchorRevision: "0".repeat(40) });
    assert.notStrictEqual(present.summary_hash, absent.summary_hash);
  });

  test("dirty_names holds path strings only (never contents, never absolute paths)", () => {
    const snap = repositorySnapshot({ cwd: fixture.cwd, anchorRevision: fixture.head });
    for (const name of snap.dirty_names) {
      assert.strictEqual(typeof name, "string");
      assert.ok(name.length > 0);
      assert.ok(!name.startsWith("/"), `dirty name must be relative: ${name}`);
    }
  });

  test("throws GitSourceError for a non-absolute cwd", () => {
    assert.throws(
      () => repositorySnapshot({ cwd: "relative", anchorRevision: fixture.head }),
      GitSourceError,
    );
  });

  test("summary_hash changes when the working tree mutates (sensitivity)", () => {
    // Isolated fixture so the shared fixture stays clean for other tests.
    const local = makeFixture();
    try {
      const before = repositorySnapshot({ cwd: local.cwd, anchorRevision: local.head });
      writeFileSync(join(local.cwd, "extra.txt"), "x\n");
      const after = repositorySnapshot({ cwd: local.cwd, anchorRevision: local.head });
      assert.strictEqual(after.dirty_path_count, before.dirty_path_count + 1);
      assert.notStrictEqual(before.summary_hash, after.summary_hash);
      assert.ok(after.dirty_names.includes("extra.txt"));
    } finally {
      rmSync(local.cwd, { recursive: true, force: true });
    }
  });
});
