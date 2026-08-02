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

Descobrir indexa conhecimento verificável e prepara um **baseline candidate**. Os schemas em `workflows/descobrir/contracts/` são a fonte de verdade do contrato de dados.

**Status atual:**

| Gate / artefato | Estado |
|---|---|
| Gate A (contrato) | Aprovado por Marley em 2026-08-02 |
| Protótipo descartável `prototypes/descobrir-v1/` | Existe; evidência Gate C coletada (ver `GATE-C.md`) — **não** é runtime de produção |
| Skill de produção `skills/descobrir/` | Ativa — Explorer + guardrails + SQLite document store (ADR 0005) |
| Human Gate (baseline aceito) | Explícito; nunca auto-accept |

A skill project-local:

- Orienta o LLM Explorer a ler saída **isolada** do Graphify (`graph.json` em cópia/worktree efêmera — path B; nunca muta o repo-fonte).
- Emite um draft com contrato exato; guardrails validam/canonicalizam (IDs recomputados; campos como `confidence` rejeitados).
- Persiste candidates em SQLite (`node:sqlite`); JSON é só export/auditoria.
- Aceita baseline somente com `coverage_report.passed === true` e identidade de aprovador.

```bash
node --test skills/descobrir/test/*.test.mjs
node skills/descobrir/cli.mjs persist-candidate --db <store.sqlite> --input <draft.json>
node skills/descobrir/cli.mjs accept --db <store.sqlite> \
  --namespace <ns> --logical-repo <repo> --graph-hash <hex> --approver "Marley"
```

### Navegação Descobrir

- Skill: [`skills/descobrir/SKILL.md`](skills/descobrir/SKILL.md)
- Fluxo: [`workflows/descobrir/FLOW.md`](workflows/descobrir/FLOW.md)
- Contratos: [`workflows/descobrir/contracts/`](workflows/descobrir/contracts/)
- ADR 0002: [`docs/adr/0002-descobrir-adapter-and-record-model.md`](docs/adr/0002-descobrir-adapter-and-record-model.md)
- ADR 0003: [`docs/adr/0003-descobrir-prototype-runtime.md`](docs/adr/0003-descobrir-prototype-runtime.md)
- ADR 0004: [`docs/adr/0004-cross-service-stitching-c4.md`](docs/adr/0004-cross-service-stitching-c4.md)
- ADR 0005: [`docs/adr/0005-descobrir-skill-sqlite-store.md`](docs/adr/0005-descobrir-skill-sqlite-store.md)
- Protótipo (descartável): [`prototypes/descobrir-v1/`](prototypes/descobrir-v1/)

## Mapa de arquivos

```
ai-dev-harness/
├── README.md
├── docs/
│   ├── domain/glossary.md
│   └── adr/
│       ├── 0001-graph-source-diagram-projection.md
│       ├── 0002-descobrir-adapter-and-record-model.md
│       ├── 0003-descobrir-prototype-runtime.md
│       ├── 0004-cross-service-stitching-c4.md
│       └── 0005-descobrir-skill-sqlite-store.md
├── skills/
│   └── descobrir/                               ← skill de produção (SQLite + CLI)
│       ├── SKILL.md
│       ├── cli.mjs
│       ├── src/
│       └── test/
├── workflows/
│   ├── project-onboarding/
│   │   ├── FLOW.md
│   │   └── diagram.html
│   └── descobrir/
│       ├── FLOW.md
│       └── contracts/                           ← schemas canônicos
├── prototypes/
│   └── descobrir-v1/                            ← protótipo descartável (Gate C)
└── examples/
    └── nori/README.md
```

## Navegação

- Fluxo detalhado do onboarding: [`workflows/project-onboarding/FLOW.md`](workflows/project-onboarding/FLOW.md)
- Vocabulário do domínio: [`docs/domain/glossary.md`](docs/domain/glossary.md)
- Decisão sobre grafo e projeções: [`docs/adr/0001-graph-source-diagram-projection.md`](docs/adr/0001-graph-source-diagram-projection.md)
- Exemplo com o Nori: [`examples/nori/README.md`](examples/nori/README.md)
