/**
 * acquireArtifacts — confined native-artifact acquisition (ADR 0003).
 *
 * Seam under test (pre-agreed): a synchronous walker that reads Native
 * Artifacts from the engine root, hashes exact bytes SHA-256, and returns a
 * dual-case shape that feeds both consumers without ambiguity:
 *
 *   - explorer-adapter.mjs           reads { path, content, contentSha256 }
 *   - graph-persistence.mjs          reads { path, content_sha256 } and the
 *                                    artifact-manifest.schema.json requires
 *                                    { path, content_sha256, role,
 *                                      declared_revision, status }
 *
 * To bridge the snake_case/camelCase split without ambiguity, every entry
 * carries BOTH `contentSha256` and `content_sha256` (identical 64-hex value),
 * AND BOTH `declaredRevision` and `declared_revision` (identical input echo).
 * Single-word fields (path, role, status) and explicit-named fields
 * (byteLength, native, content) appear once. This shape is asserted below.
 *
 * Confinement contract (ADR 0003 "Hash e preservação in-place"): symlinks
 * are rejected unconditionally via lstat, and any realpath escape from the
 * engine root is rejected BEFORE bytes are read. Raw bytes are never copied
 * to disk by this API; content lives in memory only.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acquireArtifacts, ArtifactSourceError } from "../src/artifact-source.mjs";

const DECLARED_REVISION = "633d3a5d16c165073ede2b2248bae708483f2efe";

/** Recursively snapshot a directory tree as a sorted list of "kind:name" nodes. */
function snapshotTree(root) {
  const out = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const st = statSync(full);
      out.push(`${st.isDirectory() ? "d" : "f"}:${full.slice(root.length + 1)}`);
      if (st.isDirectory()) walk(full);
    }
  }
  walk(root);
  return out;
}

/** Build an isolated repo skeleton with a nested engine tree. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "descobrir-artifact-source-"));
  const engineRoot = join(root, ".claude", "explorer");
  mkdirSync(engineRoot, { recursive: true });
  return { root, engineRoot };
}

/** Expected SHA-256 of a literal byte payload, computed independently of the SUT. */
function expectedSha256(literalBytesOrText) {
  const buf = Buffer.isBuffer(literalBytesOrText)
    ? literalBytesOrText
    : Buffer.from(literalBytesOrText, "utf8");
  return createHash("sha256").update(buf).digest("hex");
}

describe("acquireArtifacts — nested deterministic walk", () => {
  test("walks nested files in lexicographic order and returns forward-slash repo-relative paths", () => {
    const { root, engineRoot } = makeRepo();
    try {
      // Deliberately create files out of lexicographic order to assert sorting.
      writeFileSync(join(engineRoot, "overview.md"), "overview-body\n", "utf8");
      mkdirSync(join(engineRoot, "endpoints"), { recursive: true });
      writeFileSync(join(engineRoot, "endpoints", "api.md"), "API\n", "utf8");
      mkdirSync(join(engineRoot, ".claude"), { recursive: true });
      writeFileSync(join(engineRoot, ".claude", "meta.md"), "META\n", "utf8");

      const out = acquireArtifacts({
        repoRoot: root,
        engineRoot,
        declaredRevision: DECLARED_REVISION,
      });

      assert.ok(Array.isArray(out), "must return an array");
      assert.strictEqual(out.length, 3, "all three nested files captured");
      assert.deepStrictEqual(
        out.map((e) => e.path),
        [
          ".claude/explorer/.claude/meta.md",
          ".claude/explorer/endpoints/api.md",
          ".claude/explorer/overview.md",
        ],
        "paths must be sorted, repo-relative, forward-slash",
      );
      for (const p of out.map((e) => e.path)) {
        assert.ok(!p.includes("\\"), "no backslash in repo-relative path");
        assert.ok(!p.startsWith("/"), "no leading slash");
        assert.ok(!p.startsWith("../") && !p.includes("/../"), "no parent traversal");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("contentSha256 is the SHA-256 of EXACT bytes (not UTF-8 re-encoded text)", () => {
    const { root, engineRoot } = makeRepo();
    try {
      // A multibyte payload separates "UTF-8 decoded length" from "raw byte length".
      const literal = "café\n"; // é is 2 bytes in UTF-8
      const literalBuf = Buffer.from(literal, "utf8");
      writeFileSync(join(engineRoot, "data.md"), literalBuf);

      const out = acquireArtifacts({
        repoRoot: root,
        engineRoot,
        declaredRevision: DECLARED_REVISION,
      });

      assert.strictEqual(out.length, 1);
      const [entry] = out;
      assert.strictEqual(entry.contentSha256, expectedSha256(literalBuf));
      assert.strictEqual(entry.byteLength, literalBuf.length);
      assert.strictEqual(entry.byteLength, 6, "sanity: 'café\\n' is 6 bytes in UTF-8");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("acquireArtifacts — dual-case shape (adapter + manifest)", () => {
  test("every entry exposes both contentSha256 and content_sha256 with identical 64-hex value, plus full schema face", () => {
    const { root, engineRoot } = makeRepo();
    try {
      writeFileSync(join(engineRoot, "endpoints.md"), "ENDPOINTS\n", "utf8");

      const [entry] = acquireArtifacts({
        repoRoot: root,
        engineRoot,
        declaredRevision: DECLARED_REVISION,
      });

      // Adapter face (explorer-adapter.mjs)
      assert.strictEqual(typeof entry.path, "string");
      assert.strictEqual(typeof entry.content, "string");
      assert.strictEqual(entry.content, "ENDPOINTS\n");
      assert.match(entry.contentSha256, /^[a-f0-9]{64}$/);

      // Manifest face (artifact-manifest.schema.json artifactEntry)
      assert.strictEqual(entry.content_sha256, entry.contentSha256);
      assert.strictEqual(entry.role, "native");
      assert.strictEqual(entry.status, "complete");
      assert.strictEqual(entry.declared_revision, DECLARED_REVISION);

      // Cross-case aliasing is explicit and unambiguous
      assert.strictEqual(entry.declaredRevision, entry.declared_revision);

      // Sizing + native signal
      assert.strictEqual(entry.byteLength, 10);
      assert.strictEqual(entry.native, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("output array feeds createArtifactManifest without reshaping (content_sha256 + path present)", () => {
    // Validates the contract documented at the top of this file: the manifest
    // creator reads `content_sha256` and `path` directly from each entry.
    const { root, engineRoot } = makeRepo();
    try {
      writeFileSync(join(engineRoot, "a.md"), "A\n", "utf8");
      writeFileSync(join(engineRoot, "b.md"), "BB\n", "utf8");

      const out = acquireArtifacts({
        repoRoot: root,
        engineRoot,
        declaredRevision: DECLARED_REVISION,
      });

      // createArtifactManifest sorts content_sha256 lexicographically into the
      // manifest id; simulate that consumption here to prove the shape works.
      const shaList = out.map((e) => e.content_sha256).sort();
      assert.strictEqual(shaList.length, 2);
      assert.ok(shaList.every((s) => /^[a-f0-9]{64}$/.test(s)));
      assert.deepStrictEqual(
        out.map((e) => e.path),
        [".claude/explorer/a.md", ".claude/explorer/b.md"],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("acquireArtifacts — confinement (reject before reading)", () => {
  test("rejects an escaping symlink via realpath BEFORE reading any byte outside the engine root", () => {
    const { root, engineRoot } = makeRepo();
    try {
      // Target lives OUTSIDE the engine root (and even outside the repo).
      const outsideDir = mkdtempSync(join(tmpdir(), "descobrir-outside-"));
      try {
        const outsideFile = join(outsideDir, "secret.md");
        writeFileSync(outsideFile, "TOP-SECRET\n", "utf8");

        // Symlink inside the engine root that would let us read outside bytes.
        symlinkSync(outsideFile, join(engineRoot, "escape.md"));

        let caught;
        try {
          acquireArtifacts({
            repoRoot: root,
            engineRoot,
            declaredRevision: DECLARED_REVISION,
          });
        } catch (err) {
          caught = err;
        }

        assert.ok(caught instanceof ArtifactSourceError, "must throw typed error");
        assert.match(caught.message, /symlink|escape/i);
        // No entry should ever carry the outside bytes' hash: the SUT must
        // reject before readFileSync on the symlink target.
        const outsideHash = expectedSha256("TOP-SECRET\n");
        assert.ok(
          /symlink/i.test(caught.message),
          `reject must happen at symlink-detection time (got: ${caught.message})`,
        );
        assert.doesNotMatch(caught.message, new RegExp(outsideHash));
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects ANY symlink unconditionally, even when its target is inside the engine root (strict)", () => {
    const { root, engineRoot } = makeRepo();
    try {
      writeFileSync(join(engineRoot, "real.md"), "REAL\n", "utf8");
      // In-bounds symlink: target is inside engineRoot. Still rejected — the
      // native artifact tree is untrusted and must be a literal file tree.
      symlinkSync(join(engineRoot, "real.md"), join(engineRoot, "alias.md"));

      let caught;
      try {
        acquireArtifacts({
          repoRoot: root,
          engineRoot,
          declaredRevision: DECLARED_REVISION,
        });
      } catch (err) {
        caught = err;
      }

      assert.ok(caught instanceof ArtifactSourceError);
      assert.match(caught.message, /symlink/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects when engineRoot is outside repoRoot (confinement boundary)", () => {
    const { root } = makeRepo();
    const foreignRoot = mkdtempSync(join(tmpdir(), "descobrir-foreign-"));
    try {
      writeFileSync(join(foreignRoot, "x.md"), "X\n", "utf8");

      let caught;
      try {
        acquireArtifacts({
          repoRoot: root,
          engineRoot: foreignRoot,
          declaredRevision: DECLARED_REVISION,
        });
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof ArtifactSourceError);
      assert.match(caught.message, /engineRoot|repoRoot|within|inside/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(foreignRoot, { recursive: true, force: true });
    }
  });

  test("typed ArtifactSourceError is exported and used for all rejections", () => {
    assert.strictEqual(typeof ArtifactSourceError, "function");
    const err = new ArtifactSourceError("x");
    assert.ok(err instanceof Error);
    assert.strictEqual(err.name, "ArtifactSourceError");

    for (const bad of [
      { repoRoot: "", engineRoot: "x", declaredRevision: "r" },
      { repoRoot: "x", engineRoot: "", declaredRevision: "r" },
      { repoRoot: "x", engineRoot: "y", declaredRevision: "" },
    ]) {
      let caught;
      try {
        acquireArtifacts(bad);
      } catch (e) {
        caught = e;
      }
      assert.ok(caught instanceof ArtifactSourceError, `must reject empty input ${JSON.stringify(bad)}`);
    }
  });
});

describe("acquireArtifacts — side-effect freedom and determinism", () => {
  test("does not mutate or write anything in the target repo (in-memory only)", () => {
    const { root, engineRoot } = makeRepo();
    try {
      writeFileSync(join(engineRoot, "a.md"), "A\n", "utf8");
      mkdirSync(join(engineRoot, "sub"), { recursive: true });
      writeFileSync(join(engineRoot, "sub", "b.md"), "B\n", "utf8");

      const before = snapshotTree(root);
      const out = acquireArtifacts({
        repoRoot: root,
        engineRoot,
        declaredRevision: DECLARED_REVISION,
      });
      const after = snapshotTree(root);

      assert.deepStrictEqual(before, after, "target repo tree must be unchanged");
      assert.strictEqual(out.length, 2);
      // No output file was created inside the repo by the SUT.
      assert.ok(
        !after.some((node) => node.endsWith("artifact-manifest.json")),
        "must not write any manifest into the repo",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("two calls over the same tree return deeply equal results (deterministic)", () => {
    const { root, engineRoot } = makeRepo();
    try {
      writeFileSync(join(engineRoot, "z.md"), "Z\n", "utf8");
      mkdirSync(join(engineRoot, "a"), { recursive: true });
      writeFileSync(join(engineRoot, "a", "m.md"), "M\n", "utf8");

      const a = acquireArtifacts({ repoRoot: root, engineRoot, declaredRevision: DECLARED_REVISION });
      const b = acquireArtifacts({ repoRoot: root, engineRoot, declaredRevision: DECLARED_REVISION });
      assert.deepStrictEqual(a, b);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("empty engine root returns an empty array (valid incomplete-load signal)", () => {
    const { root, engineRoot } = makeRepo();
    try {
      const out = acquireArtifacts({
        repoRoot: root,
        engineRoot,
        declaredRevision: DECLARED_REVISION,
      });
      assert.deepStrictEqual(out, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("declaredRevision is echoed on every entry (camelCase + snake_case)", () => {
    const { root, engineRoot } = makeRepo();
    try {
      writeFileSync(join(engineRoot, "one.md"), "1\n", "utf8");
      writeFileSync(join(engineRoot, "two.md"), "2\n", "utf8");
      const rev = "rev-xyz-999";
      const out = acquireArtifacts({ repoRoot: root, engineRoot, declaredRevision: rev });
      for (const e of out) {
        assert.strictEqual(e.declaredRevision, rev);
        assert.strictEqual(e.declared_revision, rev);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
