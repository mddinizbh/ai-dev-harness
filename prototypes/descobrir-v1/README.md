# descobrir-v1 — protótipo descartável (Gate C)

**Status:** throwaway scaffold. Não é skill, não é runtime permanente, não faz parte da arquitetura de produção do harness.

## Propósito

Validar de forma executável (Gate C) que o contrato do ADR 0002 / `workflows/descobrir/FLOW.md` é satisfatível para o piloto lógico `nori-cloud` na revisão pinada, usando apenas Node v26 built-ins.

Gate A já aprovou o contrato. Este diretório existe só para produzir evidência de Gate C. Quando a evidência for aceita (ou o contrato precisar de novo ciclo), apague o protótipo.

## Pré-requisitos

- Node v26+ (APIs nativas: `node:fs`, `node:crypto`, `node:child_process`, `node:test`)
- Acesso local somente-leitura ao repositório piloto (quando for rodar contra o alvo real)
- **Zero** `package.json`, `node_modules` ou instalação de dependências

## Configuração (efêmera)

1. Copie o exemplo (não commite o arquivo local com path real):

```bash
cp prototypes/descobrir-v1/descobrir.config.example.json prototypes/descobrir-v1/descobrir.config.json
```

2. Edite `descobrir.config.json` e substitua o placeholder do resolver pelo path absoluto local do repositório piloto. Paths de máquina ficam **somente** nessa config efêmera.

## Uso (um comando)

O CLI está implementado: `cli.mjs` exporta `main(options)` e roda automaticamente apenas quando invocado como entry point direto.

```bash
node prototypes/descobrir-v1/cli.mjs --config prototypes/descobrir-v1/descobrir.config.json
```

Sintaxe: exatamente `--config <file>`. Args ausentes, extras ou desconhecidos são rejeitados antes de ler a config ou rodar o pipeline.

Saída e códigos de saída:

- **stdout**: uma linha JSON com `status`, `canonical_graph_hash`, contagens de records/relations, `artifact_reference_percentage` e `repository_verified_percentage`. Sem paths absolutos (target/config/output), sem artifacts/source crus, sem secrets, sem stack traces, sem timestamps.
- **exit 0**: `coverage_report.passed` verdadeiro (`status: "passed"`).
- **exit 2**: pipeline completou mas o gate está falso (`status: "failed"`).
- **exit 1**: blocker de argumento/config/runtime. stderr recebe `<ErrorName>: <mensagem sanitizada>`, com paths absolutos conhecidos (resolver, prototype, config-dir) trocados por placeholders; nunca emite stack nem texto da config.

O entry direto não chama `process.exit()`; o código retornado por `main` é atribuído a `process.exitCode`.

Fixtures sintéticas (sem secrets) usadas pela suíte de testes:

```text
prototypes/descobrir-v1/fixtures/explorer/   # Native Artifacts sanitizados
prototypes/descobrir-v1/fixtures/source/     # trecho de código sintético
```

## Confinamento de saída

Toda saída do protótipo — Artifact Manifest, Knowledge Records, Relations, GraphIndex, Coverage Report, hashes, logs, `adapter-profile.json` — deve ser escrita **exclusivamente** sob:

```text
prototypes/descobrir-v1/output/
```

Regras:

- Não copiar corpos de Native Artifacts para `output/`
- Não criar nem modificar arquivos no repositório-alvo
- Não escrever fora de `prototypes/descobrir-v1/` dentro do harness
- Não persistir secrets, env, connection strings, paths absolutos ou conteúdo dirty em records/reports

## Gate C

O protótipo deve produzir evidência de que:

1. O Artifact Adapter emite Knowledge Records / Relations com campos obrigatórios, IDs canônicos e Evidence no shape do ADR 0002
2. O perfil concreto do piloto (`adapter-profile.json`) e o Coverage Report (Provenance Coverage, repeatability, mutation.equivalent, `passed`) são geráveis a partir dos artefatos na revisão pinada

Isso **não** publica no namespace aceito e **não** substitui o Human Gate do FLOW.

## Rollback

Remover o protótipo por completo, sem efeito residual no harness ou no alvo:

```bash
rm -rf prototypes/descobrir-v1/
```

Nenhum estado externo depende deste diretório.

## Referências

- ADR 0002 — `docs/adr/0002-descobrir-adapter-and-record-model.md`
- ADR 0003 — `docs/adr/0003-descobrir-prototype-runtime.md`
- FLOW — `workflows/descobrir/FLOW.md`
- Contratos — `workflows/descobrir/contracts/`
