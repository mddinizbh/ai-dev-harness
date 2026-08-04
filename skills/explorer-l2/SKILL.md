---
name: explorer-l2
description: >
  Explorer L2 — bind JourneySpec steps to explorer-l1 system edges (sync/async
  triggers). Use when the user says /explorer-l2, journey, macro-flow, or wants
  ordered hops over a system namespace. Does not index or stitch.
---

# explorer-l2 — journeys

```bash
node skills/explorer-l2/cli.mjs bind \
  --spec path/to/journey.json \
  --edges path/to/edges.json
```

Output: bound steps + **gaps** (honest). Human projection via
`explorer-query generate-human --layer l2` (on-demand).
