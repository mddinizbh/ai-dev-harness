/**
 * Pinned Git object reader + source snapshots for Descobrir.
 * Reads committed bytes only (never dirty working-tree content).
 * All git invocations: argv array, shell:false, explicit cwd, timeout, bounded output.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

import { GitSourceError } from "./errors.mjs";

export { GitSourceError };

const HEX_RE = /^[a-f0-9]{7,64}$/;
const FORBIDDEN_SEGMENT_CHARS = ["\\", "%", "?", "#", "@"];
const MAX_BUFFER = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

/** @param {string} message */
function fail(message) {
  throw new GitSourceError(message);
}

/** @param {unknown} value */
function describe(value) {
  if (typeof value === "string") {
    return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  }
  return String(value);
}

/**
 * @param {unknown} revision
 */
export function validateRevision(revision) {
  if (typeof revision !== "string" || !HEX_RE.test(revision)) {
    fail(`invalid revision (expected 7-64 lowercase hex chars): ${describe(revision)}`);
  }
}

/**
 * @param {unknown} relativePath
 */
export function validateRelativePath(relativePath) {
  if (typeof relativePath !== "string" || relativePath === "") {
    fail("path is empty");
  }
  if (relativePath.includes("\0")) {
    fail("path contains NUL");
  }
  if (relativePath[0] === "/") {
    fail("path must be relative (no leading slash)");
  }
  for (const seg of relativePath.split("/")) {
    if (seg === "") {
      fail("path has empty segment (no '//' or trailing '/')");
    }
    if (seg === "." || seg === "..") {
      fail(`path has forbidden '${seg}' segment`);
    }
    if (/\s/.test(seg)) {
      fail("path contains whitespace");
    }
    for (const ch of FORBIDDEN_SEGMENT_CHARS) {
      if (seg.includes(ch)) {
        fail(`path contains reserved '${ch}'`);
      }
    }
  }
}

/** @param {unknown} cwd */
function validateCwd(cwd) {
  if (typeof cwd !== "string" || cwd === "" || !isAbsolute(cwd)) {
    fail("cwd must be an absolute path");
  }
}

function minimalEnv() {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LC_ALL: "C",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
  };
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ encoding?: 'utf8' | 'buffer', timeoutMs?: number }} [opts]
 */
export function runGit(cwd, args, opts = {}) {
  validateCwd(cwd);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const encoding = opts.encoding === "buffer" ? undefined : (opts.encoding ?? "utf8");
  try {
    return execFileSync("git", args, {
      cwd,
      env: minimalEnv(),
      shell: false,
      encoding,
      maxBuffer: MAX_BUFFER,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException & { status?: number, killed?: boolean, signal?: string }} */ (
      err
    );
    if (e.killed || e.signal === "SIGTERM" || e.signal === "SIGKILL") {
      fail(`git timed out or was killed (timeoutMs=${timeoutMs})`);
    }
    if (e.code === "ENOENT") {
      fail("git binary not found on PATH");
    }
    if (Number.isInteger(e.status) && e.status !== 0) {
      const wrapped = new GitSourceError(`git ${args[0] ?? ""} failed (exit ${e.status})`);
      /** @type {any} */ (wrapped).status = e.status;
      /** @type {any} */ (wrapped).stderr = e.stderr;
      throw wrapped;
    }
    throw err;
  }
}

/** @param {unknown} err */
function isGitFailure(err) {
  return err instanceof GitSourceError && Number.isInteger(/** @type {any} */ (err).status);
}

/**
 * Parse `git status --porcelain=v1` (path names only).
 * @param {string} output
 */
export function parsePorcelainStatus(output) {
  if (typeof output !== "string") {
    fail("parsePorcelainStatus input must be a string");
  }
  /** @type {{ xy: string, path: string, orig_path: string | null }[]} */
  const entries = [];
  for (const line of output.split("\n")) {
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    let path = rest;
    /** @type {string | null} */
    let origPath = null;
    if (xy[0] === "R" || xy[0] === "C") {
      const arrow = rest.indexOf(" -> ");
      if (arrow !== -1) {
        origPath = rest.slice(0, arrow);
        path = rest.slice(arrow + 4);
      }
    }
    entries.push({ xy, path, orig_path: origPath });
  }
  return entries;
}

/**
 * Raw source status for byte-identical pre/post checks (porcelain v2).
 * @param {string} cwd
 * @param {{ timeoutMs?: number }} [opts]
 */
export function captureSourceStatusV2(cwd, opts = {}) {
  return String(runGit(cwd, ["status", "--porcelain=v2"], opts));
}

/**
 * Raw worktree registration list for leak detection.
 * @param {string} cwd
 * @param {{ timeoutMs?: number }} [opts]
 */
export function captureWorktreeList(cwd, opts = {}) {
  return String(runGit(cwd, ["worktree", "list", "--porcelain"], opts));
}

/**
 * @param {string} cwd
 * @param {string} revision
 * @param {{ timeoutMs?: number }} [opts]
 */
function assertCommitPresent(cwd, revision, opts = {}) {
  try {
    runGit(cwd, ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`], {
      ...opts,
      encoding: "utf8",
    });
  } catch (err) {
    if (isGitFailure(err) || err instanceof GitSourceError) {
      fail(`revision object not present: ${revision}`);
    }
    throw err;
  }
}

/**
 * Reject symlink blobs; confirm path exists as a regular blob at revision.
 * @param {string} cwd
 * @param {string} revision
 * @param {string} path
 * @param {{ timeoutMs?: number }} [opts]
 */
function assertRegularBlobAtRevision(cwd, revision, path, opts = {}) {
  let listing;
  try {
    listing = String(
      runGit(cwd, ["ls-tree", "-r", "--full-tree", revision, "--", path], {
        ...opts,
        encoding: "utf8",
      }),
    ).trim();
  } catch (err) {
    if (isGitFailure(err) || err instanceof GitSourceError) {
      fail(`path not present at revision: ${path}`);
    }
    throw err;
  }
  if (listing === "") {
    fail(`path not present at revision: ${path}`);
  }
  // Prefer the exact path line (ls-tree may return multiple if prefix matches).
  const lines = listing.split("\n").filter((l) => l.endsWith(`\t${path}`) || l.endsWith(` ${path}`));
  const line = lines[0] ?? listing.split("\n")[0];
  const mode = line.slice(0, 6);
  if (mode === "120000") {
    fail(`path is a symlink at revision (refusing to follow): ${path}`);
  }
  if (mode === "040000") {
    fail(`path is a tree at revision (file required): ${path}`);
  }
  if (mode !== "100644" && mode !== "100755") {
    fail(`path has unsupported git mode ${mode} at revision: ${path}`);
  }
}

/**
 * Read committed file bytes at a pinned revision.
 * @param {{ cwd: string, revision: string, path: string, timeoutMs?: number }} args
 * @returns {Buffer}
 */
export function readAtRevision({ cwd, revision, path, timeoutMs }) {
  validateCwd(cwd);
  validateRevision(revision);
  validateRelativePath(path);
  const opts = { timeoutMs };
  assertCommitPresent(cwd, revision, opts);
  assertRegularBlobAtRevision(cwd, revision, path, opts);
  try {
    const bytes = runGit(cwd, ["show", `${revision}:${path}`], {
      ...opts,
      encoding: "buffer",
    });
    return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  } catch (err) {
    if (err instanceof GitSourceError) {
      fail(`git show failed for ${revision}:${path}`);
    }
    throw err;
  }
}

/**
 * Bound reader matching repo-verifier / candidate-package injection shape.
 * @param {string} cwd
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {(args: { revision: string, path: string }) => Buffer}
 */
export function bindReadAtRevision(cwd, opts = {}) {
  validateCwd(cwd);
  return ({ revision, path }) =>
    readAtRevision({ cwd, revision, path, timeoutMs: opts.timeoutMs });
}

/** @param {string} text */
function countNonEmpty(text) {
  let count = 0;
  for (const line of text.split("\n")) {
    if (line !== "") count += 1;
  }
  return count;
}

/**
 * @param {boolean} anchorObjectPresent
 * @param {number} trackedFileCount
 * @param {string[]} dirtyNames
 */
function summaryHash(anchorObjectPresent, trackedFileCount, dirtyNames) {
  const payload = JSON.stringify({
    anchor_object_present: anchorObjectPresent,
    tracked_file_count: trackedFileCount,
    dirty_names: dirtyNames,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Deterministic mutation-relevant snapshot (names/counts only — never contents).
 * @param {{ cwd: string, anchorRevision: string, timeoutMs?: number }} args
 */
export function repositorySnapshot({ cwd, anchorRevision, timeoutMs }) {
  validateCwd(cwd);
  validateRevision(anchorRevision);
  const opts = { timeoutMs };
  let anchorObjectPresent = true;
  try {
    assertCommitPresent(cwd, anchorRevision, opts);
  } catch (err) {
    if (err instanceof GitSourceError) {
      anchorObjectPresent = false;
    } else {
      throw err;
    }
  }
  const tracked = String(runGit(cwd, ["ls-files"], { ...opts, encoding: "utf8" }));
  const trackedFileCount = countNonEmpty(tracked);
  const status = String(runGit(cwd, ["status", "--porcelain=v1"], { ...opts, encoding: "utf8" }));
  const entries = parsePorcelainStatus(status);
  const dirtyNames = entries.map((e) => e.path).sort();
  return {
    anchor_object_present: anchorObjectPresent,
    tracked_file_count: trackedFileCount,
    dirty_path_count: entries.length,
    dirty_names: dirtyNames,
    summary_hash: summaryHash(anchorObjectPresent, trackedFileCount, dirtyNames),
  };
}
