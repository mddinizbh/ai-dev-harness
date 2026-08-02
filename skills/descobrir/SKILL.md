---
name: descobrir
description: >
  Use when indexing a repository into the Project Knowledge Graph baseline candidate,
  running Descobrir, persisting or accepting a knowledge baseline, exporting a candidate
  package, or when the user mentions descobrir, baseline candidate, Graphify isolation,
  or Human Gate acceptance of structural knowledge records.
---

# Descobrir — baseline candidate skill

Project-local skill. Turns **isolated Graphify output** into a **constrained candidate package**, runs **deterministic guardrails**, and stores candidates / accepted baselines in **SQLite** (JSON is export-only).

**Semantic LLM extraction is untrusted and stochastic.** Determinism applies only to: output shape, schema validation, canonical IDs, normalization, stable ordering, `canonical_graph_hash`, pinned-revision verification, CoverageReport derivation (`passed`/counts), and transaction behavior.

Do **not** mark claims `comprovado` without repository evidence verified at the pinned revision. Draft `status:"comprovado"` is downgraded unless `readAtRevision` verifies pinned bytes. Do **not** auto-accept. Acceptance is an explicit **Human Gate**.

Contracts (source of truth): `workflows/descobrir/contracts/*.schema.json`  
Flow: `workflows/descobrir/FLOW.md`  
Store ADR: `docs/adr/0005-descobrir-skill-sqlite-store.md`

## Graphify isolation runbook (path B — mandatory)

Graphify **must never mutate the source repository**.

1. Resolve logical repo + pinned `source_revision` (Fase 1).
2. Create an **ephemeral copy or git worktree** of the target at that revision.
3. Run Graphify **only inside the ephemeral tree**. Capture `graph.json` (and any native artifacts) from there.
4. Tear down the ephemeral tree. The source working tree must be unchanged.
5. LLM Explorer reasons over `graph.json` (+ optional native artifact inventory) and emits a **draft candidate** (contract below).
6. Run guardrails: `canonicalizeCandidatePackage` (or CLI `persist-candidate`, which canonicalizes drafts).
7. Persist to SQLite. Publish only after Human Gate `accept`.

Production code in this skill **does not invoke Graphify**. Isolation is an agent/operator obligation.

### Preflight gate

Before emitting JSON, require `namespace`, `logical_repo`, pinned `source_revision`, a complete Artifact Manifest for the isolated Graphify artifacts, gate `threshold`, and mutation evidence. If any input is absent, return only a blocker list: **do not emit a partial draft, placeholders, guessed hashes, or guessed identities**.

Artifact References point to the inventoried Native Artifact (for this path, normally `graph.json`), never directly to a source-code path. A source location becomes a Repository Reference only after verification against the pinned revision. Emit a relation only when both canonical endpoint records and its semantic granularity are supported; otherwise omit it and record the unresolved modeling gap instead of collapsing it into a self-edge or another invented relation.

## Explorer output contract (exact)

Emit **one JSON object** (draft). Unknown fields are rejected. **No** `confidence`, `artifact_id`, prose scores, or invented endpoint/call-chain schemas.

```json
{
  "namespace": "<knowledge-namespace>",
  "logical_repo": "<single-token-logical-id>",
  "source_revision": "<pinned-revision>",
  "artifact_manifest": { /* artifact-manifest.schema.json */ },
  "records": [
    {
      "type": "Service",
      "natural_key": "billing",
      "name": "Billing",
      "summary": "short factual summary",
      "attributes": {},
      "status": "hipótese",
      "evidence": [
        {
          "kind": "artifact",
          "manifest_id": "<manifest id>",
          "artifact_path": "relative/path",
          "content_sha256": "<64 lowercase hex>",
          "range": { "start_line": 1, "end_line": 1 }
        }
      ]
    }
  ],
  "relations": [
    {
      "relation_type": "EXPOSES",
      "from_type": "Service",
      "from_natural_key": "billing",
      "to_type": "Endpoint",
      "to_natural_key": "get:/billing",
      "status": "hipótese",
      "evidence": [ /* at least one artifact evidence */ ]
    }
  ],
  "coverage_report": {
    "threshold": { /* gate thresholds — inputs only */ },
    "mutation": { /* pre/post equivalence evidence */ },
    "producer_baseline": { "declared_counts": {}, "indexed_counts": {}, "deltas": [] },
    "freshness": { "source_revision": "<pinned-revision>" }
  }
}
```

Rules:

- Prefer `natural_key` + `type`. Optional record `id` is **ignored as authority**.
- Relations **must** supply `from_type`/`from_natural_key`/`to_type`/`to_natural_key`. Supplied `from_record`, `to_record`, and relation `id` are ignored as authority and always recomputed.
- Emit `status:"hipótese"` by default. Draft `comprovado` is **not** trusted without injected pinned-revision verification.
- Relation endpoints must exist in the same draft's record set (after ID recomputation).
- Every artifact evidence item must resolve against `artifact_manifest` (id + path + hash + range).
- Never embed secrets, env values, connection strings, raw source, absolute paths, or dirty-file contents.
- `coverage_report` draft is a **closed input shape**: only `id`, `threshold`, `mutation`, `producer_baseline`, `repeatability`, `freshness`. Reject `passed`, `provenance`, `status_counts`, `schema_result`, `graph_index_id`, `artifact_manifest_id`, `namespace`, `source_revision`, `unresolved_ids`. Require `threshold` + `mutation`. Final report (including `passed`) is always recomputed.
- Human Gate requires recomputed `passed === true` + approver.

## Guardrails (deterministic)

Module: `src/candidate-package.mjs` → `canonicalizeCandidatePackage(draft, { readAtRevision? })`

- Reject banned/unknown fields (`confidence`, …).
- Recompute all canonical IDs; reject duplicates; sort by id.
- Always recompute relation endpoints/ids from natural keys; reject missing natural-key fields.
- Reject relations whose endpoints are missing from the record set; reject duplicate ids.
- Reject artifact evidence that does not resolve against the manifest.
- Downgrade draft `comprovado` → `hipótese` unless `readAtRevision` verifies repository evidence (via `repo-verifier`).
- Validate every entity against `workflows/descobrir/contracts`.
- Build `graph_index` and `canonical_graph_hash` (summary excluded from hash).
- **Recompute** CoverageReport from closed draft inputs (`threshold`, `mutation`, producer maps, optional repeatability baseline).
- `mutation.equivalent` is **recomputed** from stable canonical comparison of `pre`/`post` snapshots — caller boolean is never authority.
- Same-key persist with divergent package JSON is **rejected** (collision); identical JSON is idempotent.
- Draft must not include `graph_index` (always derived).
- Store boundary asserts cross-document identity, index lists/counts, graph consistency, artifact resolution, hash, and recomputed coverage before write; `accept` re-runs integrity on stored JSON.

## SQLite store + CLI

```bash
# Persist Explorer draft only (always canonicalized; no bypass heuristic)
node skills/descobrir/cli.mjs persist-candidate --db <path.sqlite> --input <draft.json>

# Human Gate accept (requires passed=true + --approver)
node skills/descobrir/cli.mjs accept --db <path.sqlite> \
  --namespace <ns> --logical-repo <repo> --graph-hash <hex> --approver "Marley"

# Export accepted baseline (JSON is audit/compat only)
node skills/descobrir/cli.mjs export --db <path.sqlite> \
  --namespace <ns> --logical-repo <repo> --accepted --output <out.json>
```

Store semantics:

- Multiple candidates per namespace + logical repo (keyed by revision + graph hash).
- One accepted baseline pointer per namespace + logical repo (atomic upsert).
- Idempotent `persist-candidate` for the same key.
- Namespace isolation on all queries.
- DB file mode `0600` when created on disk.

## Out of scope (this skill)

- L1/L2 macro-flow, Neo4j, Docker, external LLM SDK
- Invoking Graphify from production modules
- Auto-accept, normalized entity/evidence SQL tables, prototype imports

## Tests

```bash
node --test skills/descobrir/test/*.test.mjs
```
