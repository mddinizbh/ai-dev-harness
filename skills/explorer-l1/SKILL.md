---
name: explorer-l1
description: >
  Explorer L1 — stitch cross-service system edges from accepted explorer-l0
  baselines. Use when the user says /explorer-l1, /l1 (alias), /graph-system (alias),
  system edges, callers/callees cross-repo, or contract-matched joins. NOT for L0
  indexing (/explorer-l0) and NOT for journey L2 (/explorer-l2).
---

# explorer-l1 — cross-service stitch (L1)

Stitches **accepted L0 baselines** into a **system namespace** of
`contract-matched` edges. Does **not** re-run Graphify. Does **not** merge L0 namespaces.

## CLI

```bash
node skills/explorer-l1/cli.mjs stitch \
  --namespace <ns> --system-namespace <sys> \
  --repos a=/path/a,b=/path/b \
  [--pair a->b] [--frontier-dir /path] [--dry-run] [--full]

node skills/explorer-l1/cli.mjs status --namespace <ns> --system-namespace <sys>
node skills/explorer-l1/cli.mjs callers --namespace <ns> --system-namespace <sys> --repo <logical>
node skills/explorer-l1/cli.mjs callees --namespace <ns> --system-namespace <sys> --repo <logical>
```

Matcher: **config_binding** first, then path contract. Evidence class always `contract-matched`.

Install: `node skills/explorer-l1/install.mjs install`
