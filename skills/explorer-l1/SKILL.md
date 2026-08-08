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
`contract-matched` edges. The result is a structural skeleton with source
pointers, not a substitute for reading implementation bodies. Does **not**
re-run Graphify. Does **not** merge L0 namespaces.

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

## Trigger model

| Trigger | L1 source | Match |
|---------|-----------|-------|
| `http-sync` | HTTP client → controller | config binding, then path contract |
| `webhook` | HTTP contract whose path is webhook/notification | same HTTP matcher |
| `cron` | active crontab `curl` operations | each poll/fan-out call becomes one edge; `pipeline_id` links the line |
| `queue` | topic publisher → topic consumer | normalized topic contract |
| `internal` | not an L1 edge | added by L2 from accepted L0 call relations |

Cron extraction preserves `schedule`, config key, operation order and exact
`file:line`. Common JVM Kafka/SQS/SNS/Rabbit/JMS publishers and consumers are
exported as topic facts. Unknown runtime values remain config-key references;
they are never guessed.

Matcher order: **config_binding**, path contract, topic contract. Evidence
class remains `contract-matched`. The additive trigger metadata is persisted in
the existing `edge_json`; no SQLite migration is required.

Install: `node skills/explorer-l1/install.mjs install`
