---
name: explorer-l2
description: >
  Explorer L2 — bottom-up journeys: propose-from-l1 → enrich-from-l0 → bind/persist.
  Use when the user says /explorer-l2, journey, macro-flow, or wants ordered hops
  over a system namespace. Does not index or stitch. NEVER invent domain narrative
  (partner defaults, plate rules) without L0 body read.
---

# explorer-l2 — journeys (bottom-up)

## Pipeline (obrigatório)

```text
L1 system_edges  →  propose-from-l1  →  draft (só hops HTTP)
L0 accepted pkgs →  enrich-from-l0   →  anchors + hotspot warnings
                 →  bind (+ persist) →  bound/gap no SQLite
```

**Não** escrever JourneySpec de domínio na mão e “carimbar” com bind.
Spec humano só depois de enrich — ou via `synthesize`.

## synthesize (one-shot)

```bash
node skills/explorer-l2/cli.mjs synthesize \
  --system-namespace estapar-system \
  --namespace estapar \
  --db ~/.local/share/descobrir/estapar.sqlite \
  --from zul-tax --to tax-provider-controller \
  --min-score 0.9 \
  --journey-id journey-l1-zul-tax-tpc \
  --persist \
  --out /tmp/journey-spec.json
```

## Passo a passo

```bash
# 1) esqueleto só L1
node skills/explorer-l2/cli.mjs propose-from-l1 \
  --system-namespace estapar-system --from zul-tax --to tax-provider-controller \
  --min-score 0.9 --out /tmp/draft.json

# 2) âncoras L0 + warnings (body_read_required)
node skills/explorer-l2/cli.mjs enrich-from-l0 \
  --spec /tmp/draft.json --namespace estapar --out /tmp/enriched.json

# 3) bind + SQLite
node skills/explorer-l2/cli.mjs bind --spec /tmp/enriched.json --persist --namespace estapar
```

## Query

```bash
node skills/explorer-l2/cli.mjs list --system-namespace estapar-system
node skills/explorer-l2/cli.mjs show --system-namespace estapar-system --journey-id …
node skills/explorer-l2/cli.mjs journeys-for-edge --edge-id 'l1:…'
```

## Regras

| Pode | Não pode |
|------|----------|
| Step HTTP a partir de edge L1 | Claim “default RENDIMENTO” sem body de `choosePartner` |
| L0 anchors Method/Service no evidence file | Tratar enrich como verdade de domínio |
| Warning `body_read_required` | Journey complete inventada top-down |

Human gate: revisar hotspots no código; só então aceitar narrativa de domínio
(em journey human-edited) ou confiar no skeleton L1+L0 para impact de hop.
