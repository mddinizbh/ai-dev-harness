/**
 * Isolated detached Git worktree lifecycle for Descobrir runs.
 * Creates worktrees only under the caller-provided run root; always remove/prune in finally.
 * Never clean/reset/stash the source working tree.
 */

import { mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { WorktreeError } from "./errors.mjs";
import {
  GitSourceError,
  captureSourceStatusV2,
  captureWorktreeList,
  repositorySnapshot,
  runGit,
  validateRevision,
} from "./git-reader.mjs";

export { WorktreeError };

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * @param {string} message
 * @param {{ cause?: unknown }} [options]
 */
function fail(message, options = {}) {
  throw new WorktreeError(message, options);
}

/** @param {unknown} value @param {string} label */
function requireAbsolute(value, label) {
  if (typeof value !== "string" || value === "" || !isAbsolute(value)) {
    fail(`${label} must be an absolute path`);
  }
}

/** @param {AbortSignal | undefined} signal */
function throwIfAborted(signal) {
  if (signal?.aborted) {
    fail("worktree operation aborted", { cause: signal.reason });
  }
}

/**
 * @param {string} repoPath
 * @param {string} worktreePath
 * @param {{ timeoutMs?: number }} [opts]
 */
function removeWorktree(repoPath, worktreePath, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    runGit(repoPath, ["worktree", "remove", "--force", worktreePath], {
      timeoutMs,
      encoding: "utf8",
    });
  } catch {
    // Directory may already be gone or registration stale — force filesystem + prune.
    try {
      rmSync(worktreePath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  try {
    runGit(repoPath, ["worktree", "prune", "--expire", "now"], {
      timeoutMs,
      encoding: "utf8",
    });
  } catch {
    // prune best-effort; leak checks in tests catch residual registration
  }
  try {
    rmSync(worktreePath, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/**
 * Create a detached worktree at an exact commit under runRoot, run callback, always clean up.
 *
 * @param {object} args
 * @param {string} args.repoPath absolute path to the source Git repository
 * @param {string} args.revision pinned lowercase hex commit
 * @param {string} args.runRoot absolute directory that will own the worktree path
 * @param {(ctx: { worktreePath: string, signal?: AbortSignal }) => unknown | Promise<unknown>} args.callback
 * @param {AbortSignal} [args.signal]
 * @param {number} [args.timeoutMs]
 * @param {string} [args.worktreeId] optional stable subdirectory name under runRoot
 * @returns {Promise<{
 *   result: unknown,
 *   worktreePath: string,
 *   mutation: { pre: object, post: object, equivalent: boolean },
 *   sourceStatusPre: string,
 *   sourceStatusPost: string,
 *   worktreeListPre: string,
 *   worktreeListPost: string,
 * }>}
 */
export async function withDetachedWorktree({
  repoPath,
  revision,
  runRoot,
  callback,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  worktreeId,
}) {
  requireAbsolute(repoPath, "repoPath");
  requireAbsolute(runRoot, "runRoot");
  if (typeof callback !== "function") {
    fail("callback must be a function");
  }
  try {
    validateRevision(revision);
  } catch (err) {
    if (err instanceof GitSourceError) {
      fail(err.message, { cause: err });
    }
    throw err;
  }

  throwIfAborted(signal);

  const opts = { timeoutMs };
  const resolvedRepo = resolve(repoPath);
  const resolvedRun = resolve(runRoot);
  mkdirSync(resolvedRun, { recursive: true, mode: 0o700 });

  const id =
    typeof worktreeId === "string" && worktreeId !== ""
      ? worktreeId
      : `wt-${revision.slice(0, 12)}-${process.pid}-${Date.now().toString(36)}`;
  if (id.includes("..") || id.includes("/") || id.includes("\\")) {
    fail("worktreeId must be a single path segment");
  }
  const worktreePath = join(resolvedRun, id);
  if (!worktreePath.startsWith(resolvedRun + "/") && worktreePath !== resolvedRun) {
    fail("worktree path escaped runRoot");
  }

  const sourceStatusPre = captureSourceStatusV2(resolvedRepo, opts);
  const worktreeListPre = captureWorktreeList(resolvedRepo, opts);
  const preSnap = repositorySnapshot({
    cwd: resolvedRepo,
    anchorRevision: revision,
    timeoutMs,
  });

  let created = false;
  try {
    throwIfAborted(signal);
    try {
      runGit(
        resolvedRepo,
        ["worktree", "add", "--detach", worktreePath, revision],
        { ...opts, encoding: "utf8" },
      );
      created = true;
    } catch (err) {
      // Ensure partial path is gone
      removeWorktree(resolvedRepo, worktreePath, opts);
      if (err instanceof GitSourceError) {
        fail(`failed to create detached worktree at revision: ${err.message}`, {
          cause: err,
        });
      }
      throw err;
    }

    throwIfAborted(signal);

    let result;
    try {
      result = await Promise.resolve(callback({ worktreePath, signal }));
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        fail("worktree callback aborted", { cause: err });
      }
      throw err;
    }

    throwIfAborted(signal);

    // Cleanup before post snapshot so registration matches pre.
    removeWorktree(resolvedRepo, worktreePath, opts);
    created = false;

    const sourceStatusPost = captureSourceStatusV2(resolvedRepo, opts);
    const worktreeListPost = captureWorktreeList(resolvedRepo, opts);
    const postSnap = repositorySnapshot({
      cwd: resolvedRepo,
      anchorRevision: revision,
      timeoutMs,
    });

    return {
      result,
      worktreePath,
      mutation: {
        pre: preSnap,
        post: postSnap,
        equivalent:
          preSnap.summary_hash === postSnap.summary_hash &&
          sourceStatusPre === sourceStatusPost &&
          worktreeListPre === worktreeListPost,
      },
      sourceStatusPre,
      sourceStatusPost,
      worktreeListPre,
      worktreeListPost,
    };
  } catch (err) {
    if (created) {
      removeWorktree(resolvedRepo, worktreePath, opts);
    }
    throw err;
  }
}
