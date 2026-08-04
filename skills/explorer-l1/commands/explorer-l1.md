---
description: Explorer L1 — stitch system edges from accepted L0 baselines
---

# /explorer-l1

Run the **explorer-l1** skill.

User arguments: $ARGUMENTS

<!-- explorer-l1-install-owned:v1 -->

You own the runtime. Prefer:

`node ~/.agents/skills/explorer-l1/cli.mjs …`

(aliases: `~/.agents/skills/l1`)

Do not reindex with Graphify. Do not merge L0 namespaces. Edges are
`contract-matched` only. After stitch, use callers/callees or `/explorer-query`.
