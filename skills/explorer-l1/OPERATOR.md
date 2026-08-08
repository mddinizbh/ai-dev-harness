# L1 OPERATOR

## What

Cross-service stitch on **accepted** Descobrir L0 baselines. Writes
`system_edges` / `system_stitch_runs` only. Edges may be `http-sync`,
`webhook`, `cron` or `queue`; `internal` continuity belongs to L2/L0.

## Install

```bash
node skills/l1/install.mjs install
# quit + restart OpenCode
node skills/l1/install.mjs status
```

## Estapar proof

```bash
CRON=/Users/marleydiniz/IdeaProjects/Estapar/zonaazul-cron
ZUL=/Users/marleydiniz/IdeaProjects/Estapar/zul-tax
RJ=/Users/marleydiniz/IdeaProjects/Estapar/tax-provider-rj

node skills/explorer-l1/cli.mjs stitch \
  --namespace estapar \
  --system-namespace estapar-system \
  --repos "zonaazul-cron=$CRON,zul-tax=$ZUL,tax-provider-rj=$RJ" \
  --full

node skills/explorer-l1/cli.mjs callers \
  --namespace estapar --system-namespace estapar-system \
  --repo tax-provider-rj
```

Or:

```bash
node skills/explorer-l1/e2e/estapar-pair.mjs
```

## Tests

```bash
node --test skills/explorer-l1/test/*.test.mjs
```

## Safety

- Never mutates L0 `candidate_packages` / accept rows beyond sharing the DB file.
- Never auto-accept.
- Evidence = `contract-matched` only.
- A connected edge proves the transport contract, not the business rule inside either body.
