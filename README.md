# ai-dev-harness

Repositório independente para evoluir o Harness por uso real. Agnóstico a projeto e a empresa.

## O que é este repositório

O Harness é uma camada de composição sobre `opencode`/`jcode` que adiciona workflows versionados, contratos de agentes e o Project Knowledge Graph. Ele não é um runtime novo, não tem dependências de pacote e não tem remote nesta etapa.

Os arquivos aqui são documentos vivos. Skills project-local e contratos versionados vivem neste repositório; código de domínio de cada empresa continua nos repositórios de projeto.

## Princípios

**Docs-first.** Nenhum workflow vira executável antes de ter FLOW.md aprovado. O documento é o contrato; a implementação vem depois.

**YAGNI.** Só o que o workflow aprovado precisa. Store e skill entram quando o contrato e o Gate autorizam — não antes.

**Grafo como fonte factual.** O Project Knowledge Graph é a fonte de verdade sobre um projeto. Diagramas são projeções descartáveis de um Context Slice, não documentação autônoma.

**Decisões baseadas em evidência.** Propostas permanecem overlays até aprovação. Afirmações de sucesso sem evidência executável não concluem nada.

**Namespaces e fronteiras de dados estritos.** Cada projeto tem namespace próprio. Conhecimento corporativo não é promovido automaticamente para o namespace pessoal; só padrões sanitizados e aprovados explicitamente cruzam essa fronteira.

## Por que Project Onboarding vem primeiro

O onboarding constrói o Project Knowledge Graph baseline. Sem ele, não há evidência factual para alimentar os workflows seguintes.

Dependem diretamente desse grafo:

- **Technical Discovery** para mapear serviços, contratos e jornadas.
- **`html-diagram`** para projetar arquitetura navegável a partir de um Context Slice.
- **`/grill-me`** para questionar decisões com base em fatos do projeto, não suposições.

Onboarding primeiro garante que os outros workflows trabalhem com evidência real, não com memória de sessão.

## Descobrir

Descobrir indexa conhecimento verificável e prepara um **baseline candidate**.
Os schemas em `workflows/descobrir/contracts/` são a fonte de verdade do
contrato de dados. A skill de produção é **operacional** (ADR 0005 + ADR 0006):
Graphify + Explorer + guardrails + SQLite + (opcional) projeção Obsidian.

**Status atual:**

| Gate / artefato | Estado |
|---|---|
| Gate A (contrato) | Aprovado por Marley em 2026-08-02 |
| Protótipo descartável `prototypes/descobrir-v1/` | Existe — **não** é runtime de produção |
| Skill de produção `skills/descobrir/` | **L0 operacional entregue** (install, setup, prepare, protocol, finalize, accept, project-obsidian, status, cleanup, E2E fake) |
| Human Gate (baseline aceito) | Explícito; **nunca** auto-accept |
| L1/L2 / Neo4j / Docker | **Deferred** |

### Escopo L0 vs deferred

| Item | Estado |
|---|---|
| Install global + `/descobrir` one-invocation | Entregue |
| Graphify pinado `0.9.32` em worktree isolada | Entregue |
| prepare / finalize determinísticos | Entregue |
| Explorer só semântica | Entregue |
| SQLite central por namespace (XDG) | Entregue |
| Obsidian one-way (baseline aceito) | Entregue |
| L1/L2 stitching, Neo4j, Docker | Deferred |

### Operação rápida

```bash
# 1) Instalar skill/comando global (symlink live; reinicie o OpenCode depois)
node skills/descobrir/install.mjs install

# 2) Setup Graphify pinado (uma vez por máquina)
node skills/descobrir/cli.mjs setup
node skills/descobrir/cli.mjs setup-status

# 3) No OpenCode (qualquer repo Git): /descobrir <projeto>
#    Ou CLI determinística:
node skills/descobrir/cli.mjs prepare \
  --namespace <ns> --logical-repo <repo> --project-path <abs-git-root>
# Explorer grava payloads em <run_root>/explorer/payloads/
node skills/descobrir/cli.mjs finalize \
  --run-root <abs-run-root> --db <store.sqlite> --source-repo <abs-git-root>
node skills/descobrir/cli.mjs accept --db <store.sqlite> \
  --candidate-id <id> --approver "Marley"
node skills/descobrir/cli.mjs project-obsidian --db <store.sqlite> \
  --namespace <ns> --logical-repo <repo> --out <projection-root>

# Status / recovery (não toca SQLite de candidates)
node skills/descobrir/cli.mjs status
node skills/descobrir/cli.mjs cleanup --stale

# Testes + E2E hermético (sem rede)
node --test skills/descobrir/test/*.test.mjs
node skills/descobrir/e2e/run.mjs --graphify fake
```

**Paths centrais (defaults):**

- DB: `${XDG_DATA_HOME:-~/.local/share}/descobrir/<namespace>.sqlite` (`0600`)
- Runs: `${XDG_CACHE_HOME:-~/.cache}/descobrir/runs/<run-id>/`
- Após `install`/`uninstall`: **quit e restart OpenCode**

**Exit codes:** `0` ok · `1` erro infra/typed · `2` blockers semânticos no finalize (sem write no DB)

### Navegação Descobrir

- Skill: [`skills/descobrir/SKILL.md`](skills/descobrir/SKILL.md)
- Operador: [`skills/descobrir/OPERATOR.md`](skills/descobrir/OPERATOR.md)
- Fluxo: [`workflows/descobrir/FLOW.md`](workflows/descobrir/FLOW.md)
- Contratos: [`workflows/descobrir/contracts/`](workflows/descobrir/contracts/)
- E2E: [`skills/descobrir/e2e/run.mjs`](skills/descobrir/e2e/run.mjs)
- ADR 0002–0006 em [`docs/adr/`](docs/adr/)
- Protótipo (descartável): [`prototypes/descobrir-v1/`](prototypes/descobrir-v1/)

## Mapa de arquivos

```
ai-dev-harness/
├── README.md
├── docs/
│   ├── domain/glossary.md
│   └── adr/
│       ├── 0001-… 0005-…
│       └── 0006-descobrir-operational-orchestration.md
├── skills/
│   └── descobrir/
│       ├── SKILL.md
│       ├── OPERATOR.md
│       ├── install.mjs
│       ├── cli.mjs
│       ├── commands/descobrir.md
│       ├── e2e/run.mjs
│       ├── src/
│       └── test/
├── workflows/descobrir/contracts/
├── prototypes/descobrir-v1/
└── examples/nori/
```

## Navegação

- Fluxo detalhado do onboarding: [`workflows/project-onboarding/FLOW.md`](workflows/project-onboarding/FLOW.md)
- Vocabulário do domínio: [`docs/domain/glossary.md`](docs/domain/glossary.md)
- Decisão sobre grafo e projeções: [`docs/adr/0001-graph-source-diagram-projection.md`](docs/adr/0001-graph-source-diagram-projection.md)
- Exemplo com o Nori: [`examples/nori/README.md`](examples/nori/README.md)
