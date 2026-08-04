# L1 OPERATOR

## What

Cross-service stitch on **accepted** Descobrir L0 baselines. Writes
`system_edges` / `system_stitch_runs` only.

## Install

```bash
node skills/l1/install.mjs install
# quit + restart OpenCode
node skills/l1/install.mjs status
```

## Estapar proof

```bash
ZUL=/Users/marleydiniz/IdeaProjects/Estapar/zul-tax
CTL=/Users/marleydiniz/IdeaProjects/Estapar/tax-provider-controller

node skills/l1/cli.mjs stitch \
  --namespace estapar \
  --system-namespace estapar-system \
  --repos "zul-tax=$ZUL,tax-provider-controller=$CTL" \
  --pair zul-tax->tax-provider-controller \
  --full

node skills/l1/cli.mjs callers \
  --namespace estapar --system-namespace estapar-system \
  --repo tax-provider-controller
```

Or:

```bash
node skills/l1/e2e/estapar-pair.mjs
```

## Tests

```bash
node --test skills/l1/test/*.test.mjs
```

## Safety

- Never mutates L0 `candidate_packages` / accept rows beyond sharing the DB file.
- Never auto-accept.
- Evidence = `contract-matched` only.
