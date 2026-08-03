---
description: >
  Run Descobrir on a Git project — one-invocation prepare → Explorer chunk
  dispatch → finalize of a baseline candidate, or related setup/status/cleanup.
---

# /descobrir

Run the global `descobrir` skill for: $ARGUMENTS

<!-- descobrir-install-owned:v1 -->

You are executing the strict one-invocation Descobrir protocol. Take the
project/config intent from `$ARGUMENTS` (a Git project path, plus optional
`namespace`, `logical-repo`, and `source-revision`), then run the four phases
**in order**. Do not invent intermediate draft JSON, do not run Graphify
manually, do not auto-accept baselines, and do not skip a phase.

## Phase order (strict)

1. **setup-status** — Run `node skills/descobrir/cli.mjs setup-status` and
   parse its JSON. If `installed === false` OR `matches_pin === false`, **stop**:
   tell the user to run `node skills/descobrir/cli.mjs setup`, then end the turn.
   Never fall back to a manual Graphify command.
2. **prepare** — Run `node skills/descobrir/cli.mjs prepare` with the namespace,
   logical-repo, project-path, and optional source-revision/db flags from
   `$ARGUMENTS`. Capture `run_id`, `manifest_id`, `descriptor_sha256`, and the
   `chunk_index.chunks[].chunk_key` list from the JSON output. The CLI already
   removes the isolated Graphify worktree before exit; you do not clean it up.
3. **Explorer chunk dispatch** — For every `chunk_key` in `chunk_index.chunks`,
   dispatch one Explorer subagent. Each subagent reads its chunk file under the
   run root and writes exactly one payload to `explorer/payloads/<chunk_key>.json`
   following the closed Explorer contract in `SKILL.md`. Retry only chunks whose
   payload came back with a `retryable` blocker (e.g., a banned authority field
   like `confidence`, `path`, `uri`, `id`, `status`, or `evidence`). Bound total
   attempts per chunk at **3**; chunks that already succeeded are never
   re-dispatched. If a chunk exhausts retries, end the turn with `status:
   "blocked"` and the `run_id`; do not call finalize.
4. **finalize** — Run `node skills/descobrir/cli.mjs finalize --run-root <run_root>
   --db <db.sqlite> --source-repo <project-path>`. Parse the JSON result.

## Completion criteria

- `finalized` AND `coverage.repository_verified_percentage > 0` AND
  `coverage.mutation_equivalent === true` → report `candidate_id`,
  `canonical_graph_hash`, and coverage; remind the user that acceptance is a
  separate Human Gate via `cli.mjs accept`.
- `finalize_blocked` (exit_code 2) → re-dispatch only the chunks named in
  `retryable_chunk_keys`, then re-run `finalize`. Persistence is idempotent.
- `setup_required` / `prepare_failed` → follow the matching phase-1/2 guidance
  above.

## Cleanup / cancellation

If the run is interrupted or the user cancels mid-protocol:

```bash
node skills/descobrir/cli.mjs status                       # list run roots
node skills/descobrir/cli.mjs cleanup --stale              # remove incomplete runs
node skills/descobrir/cli.mjs cleanup --run-id <id>        # remove one run
node skills/descobrir/cli.mjs cleanup --run-id <id> --force --source-repo <repo>
```

Cleanup never touches SQLite candidates. It removes only run scratch space and,
when `--source-repo` is provided, force-unregisters leftover worktrees via the
existing worktree helpers (falling back to direct removal otherwise).

Restart OpenCode after install or uninstall so skill/command discovery reloads.
