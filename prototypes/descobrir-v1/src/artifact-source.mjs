/**
 * Confined Native-Artifact acquisition for Descobrir v1 (ADR 0003).
 *
 * Reads the untrusted Native Artifact tree produced by a Discovery Engine
 * (e.g. `.claude/explorer/`) with realpath confinement, hashes the exact
 * bytes SHA-256, and returns a dual-case entry shape that feeds both
 * downstream consumers without ambiguity:
 *
 *   - explorer-adapter.mjs   reads { path, content, contentSha256 }
 *   - graph-persistence.mjs  reads { path, content_sha256 } and the artifact
 *                            manifest schema requires { path, content_sha256,
 *                            role, declared_revision, status }.
 *
 * Each entry therefore carries both `contentSha256` and `content_sha256`
 * (identical value) and both `declaredRevision` and `declared_revision`
 * (identical input echo).
 *
 * Confinement rules enforced BEFORE any byte is read:
 *   - every symlink is rejected unconditionally (lstat), because Native
 *     Artifact trees are untrusted;
 *   - the realpath of every directory and file visited must remain inside the
 *     (realpath-resolved) engine root;
 *   - the engine root itself must be a real directory inside the repo root.
 *
 * Output: an in-memory array. This module never writes to disk and never
 * copies artifact bytes anywhere. Built-ins only (node:crypto, node:fs,
 * node:path).
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export class ArtifactSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArtifactSourceError";
  }
}

function fail(message) {
  throw new ArtifactSourceError(message);
}

/** True when `absPath` is `root` or lives directly underneath it. Both must be realpath-resolved. */
function isWithin(absPath, root) {
  if (absPath === root) return true;
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  return absPath.startsWith(rootWithSep);
}

/** Repo-relative path with forward slashes, computed from canonical absolute paths. */
function toRepoRelative(repoRoot, absPath) {
  return relative(repoRoot, absPath).split(sep).join("/");
}

function walk(dir, repoRoot, engineRoot, declaredRevision, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (cause) {
    throw new ArtifactSourceError(`cannot read directory ${dir}: ${cause.message}`);
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const ent of entries) {
    const full = join(dir, ent.name);

    let lst;
    try {
      lst = lstatSync(full);
    } catch (cause) {
      throw new ArtifactSourceError(`cannot lstat ${full}: ${cause.message}`);
    }

    if (lst.isSymbolicLink()) {
      fail(`symlink rejected inside engine root: ${full}`);
    }

    if (lst.isDirectory()) {
      let realDir;
      try {
        realDir = realpathSync(full);
      } catch (cause) {
        throw new ArtifactSourceError(`cannot realpath directory ${full}: ${cause.message}`);
      }
      if (!isWithin(realDir, engineRoot)) {
        fail(`directory realpath escapes engine root: ${full}`);
      }
      walk(realDir, repoRoot, engineRoot, declaredRevision, out);
    } else if (lst.isFile()) {
      let realFile;
      try {
        realFile = realpathSync(full);
      } catch (cause) {
        throw new ArtifactSourceError(`cannot realpath file ${full}: ${cause.message}`);
      }
      if (!isWithin(realFile, engineRoot)) {
        fail(`file realpath escapes engine root: ${full}`);
      }

      let buf;
      try {
        buf = readFileSync(realFile);
      } catch (cause) {
        throw new ArtifactSourceError(`cannot read file ${full}: ${cause.message}`);
      }

      const contentSha256 = createHash("sha256").update(buf).digest("hex");
      out.push({
        path: toRepoRelative(repoRoot, realFile),
        content: buf.toString("utf8"),
        contentSha256,
        content_sha256: contentSha256,
        byteLength: buf.length,
        role: "native",
        declaredRevision,
        declared_revision: declaredRevision,
        status: "complete",
        native: true,
      });
    } else {
      fail(`unsupported file type at ${full}`);
    }
  }
}

/**
 * Acquire Native Artifacts from the engine root with realpath confinement.
 *
 * @param {object} input
 * @param {string} input.repoRoot          Absolute or relative logical repo root.
 * @param {string} input.engineRoot        Absolute path, or relative to repoRoot.
 * @param {string} input.declaredRevision  Revision stamped on every entry.
 * @returns {Array<object>}                Sorted (by repo-relative path) entries.
 */
export function acquireArtifacts({ repoRoot, engineRoot, declaredRevision }) {
  if (typeof repoRoot !== "string" || repoRoot === "") {
    fail("repoRoot is required");
  }
  if (typeof engineRoot !== "string" || engineRoot === "") {
    fail("engineRoot is required");
  }
  if (typeof declaredRevision !== "string" || declaredRevision === "") {
    fail("declaredRevision is required");
  }

  const resolvedEngine = isAbsolute(engineRoot) ? engineRoot : join(repoRoot, engineRoot);

  let realRepo;
  try {
    realRepo = realpathSync(resolve(repoRoot));
  } catch (cause) {
    throw new ArtifactSourceError(`cannot resolve repoRoot ${repoRoot}: ${cause.message}`);
  }

  let realEngine;
  try {
    realEngine = realpathSync(resolve(resolvedEngine));
  } catch (cause) {
    throw new ArtifactSourceError(`cannot resolve engineRoot ${engineRoot}: ${cause.message}`);
  }

  if (!isWithin(realEngine, realRepo)) {
    fail(
      `engineRoot must be inside repoRoot: ${realEngine} is not within ${realRepo}`,
    );
  }

  let engineStat;
  try {
    engineStat = lstatSync(realEngine);
  } catch (cause) {
    throw new ArtifactSourceError(`cannot stat engineRoot: ${cause.message}`);
  }
  if (engineStat.isSymbolicLink()) {
    fail(`engineRoot must not be a symlink: ${realEngine}`);
  }
  if (!engineStat.isDirectory()) {
    fail(`engineRoot must be a directory: ${realEngine}`);
  }

  const out = [];
  walk(realEngine, realRepo, realEngine, declaredRevision, out);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}
