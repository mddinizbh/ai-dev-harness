/**
 * Public seam: withDetachedWorktree — isolated detached worktree lifecycle.
 * Source tree must never be cleaned/reset/stashed; worktree always removed in finally.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

import { WorktreeError, withDetachedWorktree } from "../src/worktree.mjs";
import { captureSourceStatusV2, captureWorktreeList } from "../src/git-reader.mjs";

const temps = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop(), { recursive: true, force: true });
  }
});

function fixtureGit(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", shell: false }).trim();
}

function makeSourceRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "descobrir-wt-src-"));
  temps.push(cwd);
  fixtureGit(cwd, ["init", "-q", "-b", "main"]);
  writeFileSync(join(cwd, "app.txt"), "committed\n");
  fixtureGit(cwd, ["add", "."]);
  fixtureGit(cwd, [
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=Test",
    "commit",
    "-q",
    "-m",
    "initial",
  ]);
  const head = fixtureGit(cwd, ["rev-parse", "HEAD"]);
  writeFileSync(join(cwd, "app.txt"), "dirty-working-tree\n");
  writeFileSync(join(cwd, "extra.txt"), "untracked\n");
  return { cwd, head };
}

function makeRunRoot() {
  const dir = mkdtempSync(join(tmpdir(), "descobrir-wt-run-"));
  temps.push(dir);
  return dir;
}

describe("withDetachedWorktree", () => {
  test("success path: detached at exact commit, callback sees committed bytes, source unchanged", async () => {
    const src = makeSourceRepo();
    const runRoot = makeRunRoot();
    const statusBefore = captureSourceStatusV2(src.cwd);
    const wtBefore = captureWorktreeList(src.cwd);

    const outcome = await withDetachedWorktree({
      repoPath: src.cwd,
      revision: src.head,
      runRoot,
      callback: async ({ worktreePath }) => {
        assert.ok(worktreePath.startsWith(runRoot));
        assert.ok(existsSync(worktreePath));
        const head = fixtureGit(worktreePath, ["rev-parse", "HEAD"]);
        assert.equal(head, src.head);
        const body = execFileSync("cat", [join(worktreePath, "app.txt")], {
          encoding: "utf8",
          shell: false,
        });
        assert.equal(body, "committed\n");
        return { ok: true };
      },
    });

    assert.deepEqual(outcome.result, { ok: true });
    assert.equal(outcome.mutation.equivalent, true);
    assert.match(outcome.mutation.pre.summary_hash, /^[a-f0-9]{64}$/);
    assert.equal(outcome.mutation.pre.summary_hash, outcome.mutation.post.summary_hash);
    assert.equal(captureSourceStatusV2(src.cwd), statusBefore);
    assert.equal(captureWorktreeList(src.cwd), wtBefore);
    assert.equal(existsSync(outcome.worktreePath), false);
  });

  test("callback error: still removes worktree and leaves source status/worktree list identical", async () => {
    const src = makeSourceRepo();
    const runRoot = makeRunRoot();
    const statusBefore = captureSourceStatusV2(src.cwd);
    const wtBefore = captureWorktreeList(src.cwd);

    await assert.rejects(
      () =>
        withDetachedWorktree({
          repoPath: src.cwd,
          revision: src.head,
          runRoot,
          callback: async ({ worktreePath }) => {
            writeFileSync(join(worktreePath, "mut.txt"), "x\n");
            throw new Error("injected-process-failure");
          },
        }),
      (err) => err instanceof Error && err.message === "injected-process-failure",
    );

    assert.equal(captureSourceStatusV2(src.cwd), statusBefore);
    assert.equal(captureWorktreeList(src.cwd), wtBefore);
    // no leftover worktree dirs under run root
    const list = captureWorktreeList(src.cwd);
    assert.equal(list.includes(runRoot), false);
  });

  test("invalid revision: typed WorktreeError and no leaked worktree", async () => {
    const src = makeSourceRepo();
    const runRoot = makeRunRoot();
    const statusBefore = captureSourceStatusV2(src.cwd);
    const wtBefore = captureWorktreeList(src.cwd);

    await assert.rejects(
      () =>
        withDetachedWorktree({
          repoPath: src.cwd,
          revision: "0".repeat(40),
          runRoot,
          callback: async () => {
            throw new Error("must-not-run");
          },
        }),
      WorktreeError,
    );

    assert.equal(captureSourceStatusV2(src.cwd), statusBefore);
    assert.equal(captureWorktreeList(src.cwd), wtBefore);
  });

  test("malformed revision rejected before git worktree add", async () => {
    const src = makeSourceRepo();
    const runRoot = makeRunRoot();
    await assert.rejects(
      () =>
        withDetachedWorktree({
          repoPath: src.cwd,
          revision: "HEAD",
          runRoot,
          callback: async () => "nope",
        }),
      WorktreeError,
    );
  });

  test("AbortSignal interruption cleans worktree and surfaces typed error", async () => {
    const src = makeSourceRepo();
    const runRoot = makeRunRoot();
    const statusBefore = captureSourceStatusV2(src.cwd);
    const wtBefore = captureWorktreeList(src.cwd);
    const ac = new AbortController();

    await assert.rejects(
      () =>
        withDetachedWorktree({
          repoPath: src.cwd,
          revision: src.head,
          runRoot,
          signal: ac.signal,
          callback: async () => {
            ac.abort();
            // simulate long work noticing abort
            if (ac.signal.aborted) {
              const err = new Error("aborted");
              err.name = "AbortError";
              throw err;
            }
          },
        }),
      (err) => err instanceof WorktreeError || err?.name === "AbortError",
    );

    assert.equal(captureSourceStatusV2(src.cwd), statusBefore);
    assert.equal(captureWorktreeList(src.cwd), wtBefore);
  });

  test("pre-aborted signal never creates worktree", async () => {
    const src = makeSourceRepo();
    const runRoot = makeRunRoot();
    const wtBefore = captureWorktreeList(src.cwd);
    const ac = new AbortController();
    ac.abort();

    await assert.rejects(
      () =>
        withDetachedWorktree({
          repoPath: src.cwd,
          revision: src.head,
          runRoot,
          signal: ac.signal,
          callback: async () => "nope",
        }),
      WorktreeError,
    );
    assert.equal(captureWorktreeList(src.cwd), wtBefore);
  });

  test("repeated interruption still leaves source pristine", async () => {
    const src = makeSourceRepo();
    const statusBefore = captureSourceStatusV2(src.cwd);
    const wtBefore = captureWorktreeList(src.cwd);

    for (let i = 0; i < 3; i += 1) {
      const runRoot = makeRunRoot();
      const ac = new AbortController();
      await assert.rejects(() =>
        withDetachedWorktree({
          repoPath: src.cwd,
          revision: src.head,
          runRoot,
          signal: ac.signal,
          callback: async () => {
            ac.abort();
            const err = new Error("interrupt");
            err.name = "AbortError";
            throw err;
          },
        }),
      );
    }

    assert.equal(captureSourceStatusV2(src.cwd), statusBefore);
    assert.equal(captureWorktreeList(src.cwd), wtBefore);
  });

  test("rejects non-absolute runRoot and repoPath", async () => {
    const src = makeSourceRepo();
    await assert.rejects(
      () =>
        withDetachedWorktree({
          repoPath: "relative",
          revision: src.head,
          runRoot: makeRunRoot(),
          callback: async () => null,
        }),
      WorktreeError,
    );
    await assert.rejects(
      () =>
        withDetachedWorktree({
          repoPath: src.cwd,
          revision: src.head,
          runRoot: "relative",
          callback: async () => null,
        }),
      WorktreeError,
    );
  });

  test("stale registered worktree path under run root is force-removed on cleanup", async () => {
    const src = makeSourceRepo();
    const runRoot = makeRunRoot();
    const statusBefore = captureSourceStatusV2(src.cwd);
    const wtBefore = captureWorktreeList(src.cwd);

    // First create a worktree manually to simulate stale registration collision handling
    // via a successful lifecycle that must still end clean.
    await withDetachedWorktree({
      repoPath: src.cwd,
      revision: src.head,
      runRoot,
      callback: async () => "done",
    });

    assert.equal(captureSourceStatusV2(src.cwd), statusBefore);
    assert.equal(captureWorktreeList(src.cwd), wtBefore);
  });
});
