# Gate C — Evidência executável do protótipo Descobrir v1

**Status:** evidência coletada em 2026-08-02 contra o piloto lógico `nori-cloud` na revisão pinada `633d3a5d16c165073ede2b2248bae708483f2efe`.
**Natureza:** protótipo descartável (ADR 0003). Este documento registra **apenas contagens e percentuais** — nenhum path de máquina, byte de artefato ou conteúdo dirty.

## Como reproduzir

```bash
cp prototypes/descobrir-v1/descobrir.config.example.json prototypes/descobrir-v1/descobrir.config.json
# editar resolver → path local do repositório piloto (fica só nessa config efêmera, gitignored)
node prototypes/descobrir-v1/cli.mjs --config prototypes/descobrir-v1/descobrir.config.json
```

Saída confinada em `prototypes/descobrir-v1/output/` (gitignored), seis documentos, modo `0600`.

## Propriedades de segurança (todas satisfeitas)

| Propriedade | Evidência | Resultado |
|---|---|---|
| **Determinismo** | `canonical_graph_hash` idêntico em execuções independentes (`6e549dea…`); `repeatability.result = pass` (duas passagens internas do adapter sobre os mesmos bytes) | ✅ |
| **Zero mutação do alvo** | `mutation.equivalent = true`; `pre == post` (mesmo `summary_hash`, 420 tracked, 2 dirty); working tree confirmada por `git status` antes/depois — exatamente as duas sujeiras pré-existentes | ✅ |
| **Confinamento de saída** | seis documentos escritos somente sob `output/`, modo `0600`; nada fora do protótipo; nada no repositório-alvo | ✅ |
| **Fronteira de dados** | nenhum path absoluto de máquina nem display-form `nori/cloud` em qualquer documento persistido | ✅ |
| **Validação de schema** | `schema_result.valid = true`, `errors: []` — 116 records + 112 relations + manifest + GraphIndex conformes aos contratos reais | ✅ |

## Cobertura factual (piloto)

| Métrica | Valor |
|---|---|
| Knowledge Records | 116 |
| Relations | 112 |
| Total de entidades | 228 |
| Artifact Reference | 228 / 228 (100%) |
| Repository verified (`comprovado`) | 66 / 228 (28.9%) |
| Artifact-only (`hipótese`) | 162 |
| `contradição` / `stale` | 0 / 0 |

66 entidades foram verificadas contra o código na revisão pinada via `git show` confinado (`shell:false`, argv explícito, env mínimo, sem fallback pra working tree).

## Reconciliação com o produtor (Explorer `.meta.yaml`)

| Métrica | Declarado | Indexado | Delta |
|---|---|---|---|
| flows | 6 | 6 | 0 (exact) |
| insights | 0 | 0 | 0 (exact) |
| endpoints | 69 | 67 | −2 |
| producers | 9 | 8 | −1 |
| consumers | 5 | 8 | +3 |

`producer_baseline.result = pass` — toda delta carrega explicação não-vazia (trilha de auditoria). Deltas pequenas são esperadas (ADR 0002: cobertura de adapter é trabalho contínuo; lacunas viram `hipótese`).

## Entidades não resolvidas (7)

5 events + 2 flows com Repository Reference que não resolve na revisão pinada (permanecem `hipótese`, corretamente):

- `event:chatrequest/v1.event`, `event:cloud/pkg/events/contracts/payment/v1.event`, `event:payment/events/webhook/v1.event`, `event:toolapproval/v1.event`, `event:toolrequest/v1.event`
- `flow:post-iam-auth-register`, `flow:post-license-api-key-session`

Causa provável: referências de código extraídas como basename (`service_chat.go`) em vez de path repo-relativo completo. Não é falha do contrato — é lacuna do adapter, corretamente rebaixada a `hipótese`.

## Defeito encontrado no uso real e corrigido

- **stderr do `git show` vazava** `fatal: path ... does not exist` pro terminal do operador em referências não resolvidas. Não contaminava a saída persistida, mas era ruído. Corrigido em `src/git-source.mjs` (`stdio: ["ignore","pipe","pipe"]` — stderr capturado, não herdado). Re-execução confirmou stderr vazio e hash inalterado.

## Itens de reconciliação em aberto (decisão)

Não bloqueiam Gate C; melhoram cobertura:

1. **endpoints −2 / producers −1** — entender quais formas do markdown real o parser não cobre.
2. **consumers +3** — mismatch semântico: o adapter conta relações `CONSUMES`; o Explorer conta serviços consumidores únicos. Definir a métrica canônica.
3. **basename cru** — decidir se o adapter deve resolver path completo ou se o Explorer deve emitir path repo-relativo.

## Veredito

O contrato do ADR 0002 é **satisfatível e seguro** sobre o piloto real: determinístico, sem mutação, schema-válido, com proveniência medida honestamente. A inteligência do índice (cobrir as deltas) é trabalho incremental, não pré-condição de Gate C.
