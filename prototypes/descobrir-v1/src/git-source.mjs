/**
 * Safe read-only git object access + mutation snapshots for Descobrir v1 (ADR 0003
 * §"Verificação de código contra a revisão fixada (execução segura)").
 *
 * Reads file bytes at a pinned revision via `git show <rev>:<path>` using argv +
 * shell:false + minimal env, with strict hex revision and safe relative path
 * validation BEFORE spawn. Never falls back to working-tree bytes. Snapshots
 * record anchor presence, tracked count and dirty path names (never contents).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

export class GitSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = "GitSourceError";
  }
}

const HEX_RE = /^[a-f0-9]{7,64}$/;
const FORBIDDEN_SEGMENT_CHARS = ["\\", "%", "?", "#", "@"];
const MAX_BUFFER = 16 * 1024 * 1024;

function fail(reason) {
  throw new GitSourceError(reason);
}

function describe(value) {
  if (typeof value === "string") {
    return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  }
  return String(value);
}

export function validateRevision(revision) {
  if (typeof revision !== "string" || !HEX_RE.test(revision)) {
    fail(`invalid revision (expected 7-64 lowercase hex chars): ${describe(revision)}`);
  }
}

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

function validateCwd(cwd) {
  if (typeof cwd !== "string" || cwd === "" || !isAbsolute(cwd)) {
    fail("cwd must be an absolute path");
  }
}

// Minimal, non-inheriting env: only what git needs to run read-only. Global and
// system config are nulled so user secrets/aliases never leak into the spawn.
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

function runGit(cwd, args, encoding) {
  return execFileSync("git", args, {
    cwd,
    env: minimalEnv(),
    shell: false,
    encoding,
    maxBuffer: MAX_BUFFER,
    // Capture the child's stderr instead of letting it inherit the parent
    // terminal. An expected failure (e.g. path absent at revision) prints
    // `fatal: ...` to git's stderr; that is operator noise, not evidence, and
    // it is surfaced through the thrown error's `.stderr` when needed.
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isGitFailure(err) {
  // execFileSync sets .status to the exit code on non-zero exit; ENOENT (git
  // binary missing) sets .code === "ENOENT" with no .status and must surface.
  return Number.isInteger(err.status) && err.status !== 0;
}

// Parses `git status --porcelain=v1` output. Each well-formed line is
// `<XY><space><path>`; rename/copy lines carry `<orig> -> <new>`. Returns path
// names only — never contents. Malformed short lines are ignored.
export function parsePorcelainStatus(output) {
  if (typeof output !== "string") {
    fail("parsePorcelainStatus input must be a string");
  }
  const entries = [];
  for (const line of output.split("\n")) {
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    let path = rest;
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

export function readFileAtRevision({ cwd, revision, path }) {
  validateCwd(cwd);
  validateRevision(revision);
  validateRelativePath(path);
  try {
    // Single argv element `<rev>:<path>` — no shell, validated before spawn.
    // Returns the raw committed bytes (Buffer); no working-tree fallback.
    return runGit(cwd, ["show", `${revision}:${path}`], undefined);
  } catch (err) {
    if (isGitFailure(err)) {
      fail(`git show failed for ${revision}:${path} (exit ${err.status})`);
    }
    throw err;
  }
}

function checkAnchor(cwd, anchorRevision) {
  try {
    runGit(cwd, ["rev-parse", "--verify", "--quiet", `${anchorRevision}^{commit}`], "utf8");
    return true;
  } catch (err) {
    if (isGitFailure(err)) return false;
    throw err;
  }
}

function countNonEmpty(text) {
  let count = 0;
  for (const line of text.split("\n")) {
    if (line !== "") count += 1;
  }
  return count;
}

function summaryHash(anchorObjectPresent, trackedFileCount, dirtyNames) {
  // Canonical, insertion-ordered serialization → deterministic SHA-256.
  const payload = JSON.stringify({
    anchor_object_present: anchorObjectPresent,
    tracked_file_count: trackedFileCount,
    dirty_names: dirtyNames,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function repositorySnapshot({ cwd, anchorRevision }) {
  validateCwd(cwd);
  validateRevision(anchorRevision);
  const anchorObjectPresent = checkAnchor(cwd, anchorRevision);
  const tracked = runGit(cwd, ["ls-files"], "utf8");
  const trackedFileCount = countNonEmpty(tracked);
  const status = runGit(cwd, ["status", "--porcelain=v1"], "utf8");
  const entries = parsePorcelainStatus(status);
  // Sort by code unit for locale-independent determinism (matches LC_ALL=C).
  const dirtyNames = entries.map((e) => e.path).sort();
  return {
    anchor_object_present: anchorObjectPresent,
    tracked_file_count: trackedFileCount,
    dirty_path_count: entries.length,
    dirty_names: dirtyNames,
    summary_hash: summaryHash(anchorObjectPresent, trackedFileCount, dirtyNames),
  };
}
