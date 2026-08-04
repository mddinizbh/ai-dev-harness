---
name: explorer-query
description: >
  Orchestrate explorer-l* pipeline: ensure (build↑ stitch from frontiers) and
  answer/context-pack (query↓ L2→L1→code pointers). On-demand generate-human to
  .explorer/L{N}.md in the repo. Use when the user says /explorer-query, context-pack,
  ensure-domain, or list-projections. Prefer this over broad repo grep.
---

# explorer-query

## Build ↑

```bash
node skills/explorer-query/cli.mjs ensure \
  --namespace demo --system-namespace demo-system \
  --repos svc-a,svc-b \
  --frontier-dir /path/to/frontiers \
  --system-db /tmp/sys.sqlite \
  --config-map B_URL=svc-b
```

## Query ↓

```bash
node skills/explorer-query/cli.mjs answer \
  --system-namespace demo-system \
  --edges /path/edges.json \
  [--journey journey.json] \
  [--question "debits"] \
  [--repo-root . --with-projections]
```

## Human projection (on-demand, repo primary)

```bash
node skills/explorer-query/cli.mjs generate-human \
  --repo-root . --layer l1 --from-pack pack.json

node skills/explorer-query/cli.mjs list-projections --repo-root .
```

**Protocol:** run `answer` / `list-projections` before broad codebase search.
Never auto-write `.explorer/*.md` on stitch — only `generate-human`.
