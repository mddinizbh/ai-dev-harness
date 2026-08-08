# Memória — pós-v2: Query → Slice → Pack → contexto do agente

> Estado de referência: 2026-08-07. Este documento descreve o trabalho **posterior à conclusão integral** do plano `.omo/plans/persistent-context-slice-engine-v2.md`.

## Objetivo

Completar o caminho entre a base factual construída pelo Descobrir e um agente capaz de executar uma tarefa com contexto verificável:

```text
Código
  → L0
  → L1
  → L2
  → Query Interpreter
  → Slice Materializer
  → Context Slice
  → Pack Projector
  → Context Pack
  → Context Hydrator
  → AgentContextEnvelope
  → Task Agent
  → resposta/alteração com evidence
```

O v2 entrega o núcleo determinístico `seeds/policy → Slice → Pack`. Ele não entrega interpretação de linguagem natural, hidratação de arquivos no contexto, execução do agente nem validação das citações produzidas pelo agente.

---

## 1. O que deve existir ao terminar o v2

Ao concluir Todos 1–19 e verificadores F1–F4, o núcleo deve fornecer:

- seeds fechadas `l0_fact | l1_edge | l2_journey`;
- policies determinísticas `journey@1 | impact@1 | drill-down@1`;
- `derivation_key` exaustiva e versionada;
- materialização determinística e persistente do Slice;
- cache miss/hit e `context_slice_current`;
- coverage e misses explícitos;
- Pack determinístico com orçamento por nodes, edges e caracteres;
- comandos `slice`, `slice-show`, `slice-gc` e `answer --use-slice-cache`;
- rollout opt-in, métricas, GC e E2E hermético.

Esse núcleo permanece sem LLM. Sua interface recebe seeds e policy tipadas e devolve Slice/Pack canônicos.

---

## 2. Separação de responsabilidades

### 2.1 Perguntas fundamentais

- **Slice:** o que é semanticamente relevante para esta tarefa?
- **Pack:** o que dessa fatia cabe no orçamento do consumidor?
- **Hydrator:** quais bytes de código correspondem às evidências portáveis?
- **LLM:** o que esses fatos significam e qual ação deve ser executada?

### 2.2 Determinístico × LLM × humano

| Etapa | Responsável |
|---|---|
| Graphify/AST | Código determinístico |
| Explorer semântico da carga inicial | LLM |
| IDs, hashes, evidence, finalize e persistência L0 | Código determinístico |
| Aceitação do baseline | Human Gate |
| FrontierFacts, stitch L1 e bind L2 | Código determinístico |
| Pergunta natural → QueryRequest | LLM opcional |
| Validação de QueryRequest | Código determinístico |
| Materialização do Slice | Código determinístico |
| Projeção do Pack | Código determinístico |
| Resolução e hidratação dos arquivos | Código determinístico |
| Execução da tarefa | LLM |
| Validação de citations/evidence | Código determinístico |
| Aceitação de mudança de alto impacto | Humano |

O LLM nunca escolhe silenciosamente quais fatos entram no Slice ou quais itens obrigatórios são removidos do Pack.

---

## 3. Roadmap pós-v2

## Wave A — contrato tipado da query

Criar um contrato entre linguagem natural e o núcleo determinístico:

```json
{
  "raw_query": "Por que a consulta de endereço falha?",
  "system_namespace": "demo",
  "intent": "debug",
  "proposed_seeds": [
    {
      "kind": "l0_fact",
      "namespace": "demo",
      "logical_repo": "cliente-service",
      "fact_id": "l0:ff:http_outbound:..."
    }
  ],
  "proposed_policy": {
    "name": "impact",
    "version": 1,
    "options": {}
  },
  "proposed_budget": {
    "max_chars": 12000
  }
}
```

Entregáveis sugeridos:

- `skills/explorer-query/contracts/query-request.schema.json`;
- `skills/explorer-query/src/query-request.mjs`;
- normalização e validação determinísticas;
- confiança e motivos de ambiguidade;
- rejeição de seed textual/path fora da taxonomia fechada.

## Wave B — Query Interpreter

Primeiro estágio LLM pós-v2:

```text
Pergunta natural
  → LLM propõe intent/seeds/policy/budget
  → QueryRequest tipado
  → validação determinística
  → Slice Materializer
```

Regras:

- seleção de modelo pertence ao runtime do agente, não às skills determinísticas;
- output deve ser tool call/structured output validado pelo schema;
- falha de schema permite uma correção; segunda falha promove modelo ou pede intervenção;
- baixa confiança não vira seed inventada;
- query estruturada pode ignorar o LLM e chamar o núcleo diretamente.

Entregável docs-first: `workflows/query-interpret/FLOW.md`.

## Wave C — Portable Evidence & Context Hydration

O modelo não lê arquivos apenas porque recebeu um path. Entre Pack e LLM deve existir um Hydrator.

### Evidence canônica, agnóstica à máquina

Nunca persistir paths absolutos. Usar identidade lógica:

```json
{
  "evidence_id": "evidence:abc123",
  "namespace": "demo",
  "logical_repo": "cliente-service",
  "source_revision": "a1b2c3d",
  "artifact_path": "src/main/kotlin/ClienteService.kt",
  "range": {
    "start_line": 38,
    "end_line": 52
  },
  "content_sha256": "..."
}
```

Forma URI equivalente:

```text
repo://cliente-service@a1b2c3d/src/main/kotlin/ClienteService.kt#L38-L52
```

### RepoBinding local

Cada máquina fornece um binding transitório:

```json
{
  "cliente-service": "/workspace/repos/cliente-service",
  "address-service": "/workspace/repos/address-service"
}
```

O binding:

- não entra no Slice/Pack;
- não participa dos hashes;
- nunca aparece na resposta do agente;
- apenas localiza o checkout ou Git object database local.

### Context Hydrator

Para cada pointer obrigatório:

1. resolver `logical_repo` pelo RepoBinding;
2. validar que `artifact_path` é relativo e não escapa da raiz;
3. resolver a revisão exata, preferencialmente pelo Git object store;
4. ler somente range/símbolo permitido;
5. calcular e comparar `content_sha256`;
6. produzir conteúdo hidratado ou erro tipado;
7. nunca cair silenciosamente para a working tree atual.

Erros fechados:

- `repo_binding_missing`;
- `revision_unavailable`;
- `artifact_missing`;
- `path_escape`;
- `hash_mismatch`;
- `range_invalid`;
- `binary_or_oversized`.

### Estratégia eager + lazy

- **Eager:** seeds, caminho crítico, configs e evidence indispensável entram antes da primeira chamada do LLM.
- **Lazy:** vizinhos secundários permanecem como pointers e podem ser carregados por `read_code_pointer(evidence_id)`.

### AgentContextEnvelope

O LLM recebe um envelope hidratado, não apenas o Pack:

```json
{
  "pack_id": "pack:abc123",
  "slice_hash": "...",
  "question": "Por que a consulta de endereço falha?",
  "context": {
    "summary": "...",
    "nodes": [],
    "edges": [],
    "code": [
      {
        "evidence_id": "evidence:123",
        "logical_repo": "cliente-service",
        "artifact_path": "src/main/kotlin/ClienteService.kt",
        "range": "38-52",
        "content": "fun buscar(...) { ... }",
        "hash_verified": true
      }
    ]
  }
}
```

### ContextLoadReceipt

Gerar recibo verificável:

```json
{
  "pack_id": "pack:abc123",
  "required_pointers": 5,
  "hydrated_pointers": 5,
  "failed_pointers": 0,
  "loaded_chars": 8420,
  "hash_verified": 5,
  "evidence_ids": ["evidence:123", "evidence:456"]
}
```

O recibo prova que os bytes corretos foram colocados no contexto. Não prova atenção cognitiva do modelo; isso é tratado por citações e evals.

Entregáveis sugeridos:

- `contracts/code-pointer.schema.json`;
- `contracts/agent-context.schema.json`;
- `contracts/context-load-receipt.schema.json`;
- `src/repo-binding.mjs`;
- `src/context-hydrator.mjs`;
- `src/agent-context.mjs`;
- ferramenta `read_code_pointer`.

## Wave D — Task Agent

Segundo estágio LLM pós-v2:

```text
AgentContextEnvelope
  → Task Agent
  → ferramentas permitidas
  → resposta/patch
  → TaskOutcome com evidence IDs
```

Regras:

- toda conclusão factual cita evidence hidratada;
- toda ferramenta é namespace/repo-scoped;
- o modelo não recebe paths absolutos;
- alteração de código só ocorre quando a tarefa atual autoriza implementação;
- tarefas de alto impacto podem produzir proposta/patch pendente de Human Gate;
- ausência de evidence vira incerteza explícita, nunca invenção.

Entregável docs-first: `workflows/task-execution/FLOW.md`.

## Wave E — Citation Validator e feedback

Após o agente:

```text
TaskOutcome
  → validar evidence IDs citadas
  → conferir se foram hidratadas
  → conferir repo/revision/hash
  → registrar sucesso, miss ou lacuna de indexação
```

O feedback não altera automaticamente o grafo aceito. Ele pode propor:

- nova seed/policy;
- reindexação de arquivo/repo;
- overlay de conhecimento;
- ajuste de orçamento;
- caso de avaliação regressiva.

Entregáveis sugeridos:

- `contracts/task-outcome.schema.json`;
- `src/citation-validator.mjs`;
- `src/slice-feedback.mjs`.

## Wave F — observabilidade, segurança, evals e rollout

### Métricas

- query interpretation confidence;
- schema retry/escalation;
- slice cache hit/miss;
- Pack truncation e budget usado;
- pointers requeridos/hidratados/falhos;
- chars/tokens hidratados;
- tool calls por tarefa;
- citations válidas/inválidas;
- taxa de sucesso por modelo/fase;
- custo estimado por tarefa.

### Segurança

- proteção contra path traversal e symlink escape;
- leitura apenas de repo/revision autorizados;
- redaction de secrets antes do contexto;
- detecção de prompt injection dentro de código/documentos;
- tool bindings mínimos por tarefa;
- nenhuma promoção cross-namespace automática.

### Evals

- query → seeds/policy esperadas;
- Slice → coverage/misses esperados;
- Pack → itens obrigatórios preservados;
- pointer → bytes/hash esperados;
- Pack hidratado → resposta com citações corretas;
- código malicioso no repo não altera system instructions;
- modelo barato promove corretamente para modelo forte quando necessário.

### Rollout

- flags independentes: `use_query_interpreter`, `use_context_hydrator`, `use_task_agent`;
- shadow mode antes de permitir execução;
- rollback por flag, sem apagar L0/L1/L2/Slices;
- canary por namespace/projeto;
- budgets e modelos configurados por runtime.

---

## 4. Roteamento de modelos por fase

> Recomendações de ponto no tempo. Preços e nomes mudam; revalidar antes de contratar capacidade. A decisão final deve ser baseada em evals do nosso corpus, não em marketing de benchmark.

## 4.1 Carga inicial do repositório — alto volume, assíncrona

### Trabalho

- Explorer semântico por chunks;
- output estruturado;
- grande volume;
- tolerância a batch de horas;
- custo domina mais que latência.

### Recomendação

Usar modelo economy/fast em Batch:

1. **Gemini 3.6 Flash Batch** — opção GA com 1M de contexto e structured output;
2. **Claude Haiku 4.5 Message Batches** — bom para extração instruída por schema;
3. **GPT-5.6 Luna Batch** — piso de custo com `strict:true`, exigindo QA amostral;
4. DeepSeek V4 Flash apenas onde compliance/residência permitirem e com margem para reajuste de preço.

Estratégia:

- arquivos gerados, testes repetitivos e boilerplate → economy;
- domínio, integrações e configurações críticas → fast/balanced;
- amostrar pelo menos 1% com modelo superior;
- falha de schema ou baixa cobertura → promover somente o chunk;
- batch e prompt caching obrigatórios.

## 4.2 Query natural → QueryRequest — baixa latência, schema estrito

### Recomendação

- primário custo/qualidade: **Gemini 3.6 Flash** ou **Claude Sonnet 5**;
- fallback equivalente: **GPT-5.6 Terra** com Structured Outputs;
- economia adicional somente após eval provar precisão de intent/seeds/policy.

O modelo deve fazer apenas interpretação. A validação e resolução das seeds permanecem determinísticas.

Escalonamento:

```text
modelo balanced
  → schema inválido: uma correção
  → ambiguidade/seed ausente: modelo strong ou Human Gate
  → nunca inventar ID
```

## 4.3 Hidratação — nenhum LLM

RepoBinding, leitura Git, verificação de hash, ranges, orçamento de bytes e construção do envelope são 100% código determinístico.

Não gastar tokens para uma tarefa que filesystem/Git/hash resolvem com mais precisão.

## 4.4 Execução de tarefa — qualidade adaptativa

### Default custo-benefício

- **Claude Sonnet 5** como agente padrão de implementação/diagnóstico;
- **GPT-5.6 Terra** como alternativa balanced;
- **Gemini 3.1 Pro** como alternativa de contexto longo/custo.

### Promoção para tarefas difíceis

- **Claude Opus 5**;
- **GPT-5.6 Sol**.

Promover quando ocorrer:

- arquitetura multi-sistema;
- debugging após duas hipóteses falharem;
- segurança/performance/concurrency;
- mais de N falhas de ferramenta;
- Context Pack com contradições ou muitos misses;
- baixa confiança declarada;
- mudança de alto impacto.

Não usar flagship por padrão para carga inicial ou queries simples.

## 4.5 Verificação e revisão

Usar modelo forte e, quando possível, diferente do executor:

- Claude Opus 5 Batch ou GPT-5.6 Sol Batch para revisão assíncrona;
- Gemini 3.1 Pro Batch como alternativa de menor custo;
- Sonnet 5 Batch para mudanças comuns com promoção em verdict `uncertain`.

Separar papéis:

```text
executor balanced
  → testes determinísticos
  → reviewer strong
  → Human Gate quando necessário
```

---

## 5. Política de roteamento recomendada

Configuração no runtime do agente, não dentro das skills:

```text
MODEL_EXTRACTION_ECONOMY
MODEL_EXTRACTION_CRITICAL
MODEL_QUERY_INTERPRET
MODEL_TASK_DEFAULT
MODEL_TASK_HARD
MODEL_REVIEW
```

Regras:

1. pelo menos dois provedores suportados por fase;
2. Batch para toda atividade não interativa;
3. cachear o maior prefixo estável: system prompt, schemas e Pack;
4. evitar enviar Context Packs gigantes; Pack existe para controlar isso;
5. budget e nível de raciocínio começam médios e aumentam sob evidência;
6. retry único no mesmo modelo; depois promover, não repetir indefinidamente;
7. registrar custo, latência, schema success e task success por modelo;
8. reavaliar roteamento periodicamente com evals internos.

### Matriz resumida

| Fase | Tier padrão | Tier de promoção |
|---|---|---|
| Extração em massa | Economy/Flash Batch | Balanced apenas para chunks críticos |
| Query Interpreter | Fast/Balanced | Strong para ambiguidade |
| Slice/Pack | Nenhum LLM | Nenhum LLM |
| Hydrator | Nenhum LLM | Nenhum LLM |
| Task Agent comum | Balanced | Flagship para tarefa difícil |
| Review | Strong Batch | Flagship sync para alto risco |

---

## 6. Critérios de conclusão do alvo

O pipeline só está completo quando um E2E hermético provar:

```text
pergunta natural
  → QueryRequest schema-valid
  → Slice miss
  → Slice hit idêntico
  → Pack dentro do budget
  → RepoBinding sem path persistido
  → evidence hidratada da revisão correta
  → ContextLoadReceipt sem falhas obrigatórias
  → Task Agent recebe o AgentContextEnvelope
  → resposta cita evidence IDs hidratadas
  → Citation Validator aprova
```

Failure cases obrigatórios:

- query ambígua;
- baseline ausente;
- repo binding ausente;
- revisão Git indisponível;
- hash divergente;
- path traversal;
- Pack pequeno demais para seeds;
- prompt injection em código;
- citation não hidratada;
- modelo barato falha e promoção funciona;
- rollback por feature flag preserva o núcleo.

---

## 7. Épico — Git-Native Knowledge Repository

### Motivação

O uso principal não é apenas reduzir tokens. É manter uma memória arquitetural portátil da empresa, do macro ao micro, sem exigir um banco central:

```text
L0 → interior de cada serviço
L1 → conexões entre serviços
L2 → jornadas do sistema
Slice → recorte relevante para a tarefa
Pack → contexto entregue ao agente
```

Um desenvolvedor deve conseguir clonar o knowledge repository, reconstruir ou baixar o SQLite local e imediatamente consultar serviços já indexados.

### Decisão: Git canônico, SQLite derivado

O arquivo SQLite não deve ser a única fonte de verdade colaborativa. Um SQLite mutável no Git possui problemas estruturais:

- não há merge semântico;
- alterações em páginas binárias geram conflitos amplos;
- o PR não mostra records/edges/journeys alterados;
- branches que indexam serviços diferentes podem conflitar no mesmo arquivo;
- resolver conflito significa escolher/reconstruir um banco inteiro;
- histórico binário tende a crescer rapidamente.

Modelo decidido:

> Git guarda artefatos canônicos, imutáveis e revisáveis. SQLite é uma materialized view local, descartável e reproduzível.

### Estrutura proposta

```text
company-architecture-knowledge/
├── objects/
│   ├── l0/<candidate-hash>.json.zst
│   ├── l1/<edge-set-hash>.json.zst
│   └── l2/<journey-hash>.json.zst
├── refs/
│   ├── repos/<namespace>/<logical-repo>.json
│   └── systems/<system-namespace>.json
├── journeys/
├── schemas/
├── reports/
│   └── semantic-diff/
├── manifest.lock
└── dist/
    └── company-context.sqlite  # opcional e gerado
```

#### `objects/`

- content-addressed;
- imutável;
- nomeado por hash;
- nunca alterado in-place;
- pode ser comprimido desde que o conteúdo canônico descomprimido seja hash-verificável.

#### `refs/`

Representam ponteiros aceitos:

```json
{
  "namespace": "empresa",
  "logical_repo": "cliente-service",
  "candidate_id": "candidate:...",
  "canonical_graph_hash": "...",
  "source_revision": "git-sha",
  "object": "objects/l0/<hash>.json.zst",
  "accepted_by": "...",
  "accepted_at": "..."
}
```

Conflitos ficam restritos ao ref do mesmo serviço, em vez de afetar um SQLite global.

#### `manifest.lock`

Fecha uma versão coerente da memória:

```text
repos aceitos
+ edge set L1
+ journeys/binds L2
+ versões dos schemas/engines
= snapshot reproduzível
```

### Fluxo do desenvolvedor

```text
1. Clona o knowledge repository.
2. Baixa ou gera company-context.sqlite.
3. Consulta os serviços já indexados.
4. Indexa novos serviços ou revisions.
5. Gera novos objects imutáveis.
6. Atualiza somente os refs afetados.
7. Gera semantic diff.
8. Abre PR.
9. CI valida hashes, schemas, revisions e Human Gate.
10. CI recalcula L1/L2 afetados.
11. CI reconstrói SQLite e prova round-trip.
12. CODEOWNERS revisam e aprovam.
13. Merge publica uma nova memória arquitetural.
```

### Fluxo de atualização após feature

```text
feature mergeada no service repo
  → source_revision nova
  → indexação do serviço alterado
  → candidate L0 novo e imutável
  → recomputar frontier delta
  → recomputar L1 afetado
  → rebind L2 afetado
  → invalidar Slices pelas hashes
  → PR automático no knowledge repository
```

Indexação incremental por diff de código é um épico próprio. Até sua entrega, a primeira versão pode reindexar integralmente apenas os logical repos alterados, mantendo L1/L2/Slices derivados e content-addressed.

### SQLite distribuído

`dist/company-context.sqlite` pode existir para bootstrap rápido, mas deve ser:

- gerado por comando/CI;
- nunca editado manualmente;
- reproduzível a partir de `manifest.lock`;
- opcionalmente publicado no Git LFS ou GitHub Release;
- reconstruído em caso de conflito;
- fechado/checkpointed, sem arquivos `-wal` ou `-shm`.

O SQLite local é o formato otimizado para query; os objetos Git são o formato otimizado para colaboração e revisão.

### Semantic Diff obrigatório

Todo PR precisa mostrar, em Markdown/JSON legível:

```text
L0
  + records
  - records
  ~ records alterados
  +/− relations
  coverage/misses alterados

L1
  +/− SystemEdges
  score/match_kind/contract alterados

L2
  journeys/binds alterados
  novos gaps ou gaps resolvidos
```

O reviewer não deve precisar baixar e abrir SQLite para entender a mudança.

### Governança

- CODEOWNERS por namespace/logical repo;
- arquitetura/plataforma revisa mudanças cross-service L1/L2;
- Human Gate continua explícito;
- consenso entre agentes não equivale a aprovação;
- ref aceito só muda depois dos gates do PR;
- objects históricos permanecem até política de retenção explícita.

### Segurança e data boundary

O knowledge repository privado não deve virar uma cópia indiscriminada do código:

- evidence guarda `logical_repo`, revision, path relativo, range e hash;
- evitar snippets extensos quando pointer verificável for suficiente;
- secrets e arquivos proibidos são bloqueados antes da exportação;
- paths absolutos nunca são exportados;
- promoção entre namespaces/empresas nunca é automática;
- exclusão de secret exige considerar o histórico permanente do Git.

### Migração em duas fases

Para não criar duas fontes de verdade:

#### Fase 1 — export/import verificável

- SQLite atual permanece operacional;
- exportar estado aceito para objects/refs canônicos;
- importar objects/refs em DB vazio;
- provar igualdade de IDs, hashes e outputs de query;
- CI gera semantic diff e SQLite, mas o runtime antigo ainda pode operar.

#### Fase 2 — Git como fonte de distribuição

- `manifest.lock` passa a definir o snapshot distribuído;
- o SQLite local é sempre reconstruído/baixado desse snapshot;
- writes locais geram candidates/objects e PR, não mutação canônica compartilhada;
- merge do PR publica novos refs aceitos;
- qualquer cache SQLite pode ser apagado sem perder conhecimento.

### Entregáveis do épico

1. ADR `Git canonical artifacts + derived SQLite`;
2. schemas de object/ref/manifest;
3. exportador SQLite → knowledge objects;
4. importador knowledge objects → SQLite;
5. round-trip hash verifier;
6. semantic diff CLI;
7. CI de PR e geração do SQLite;
8. CODEOWNERS e Human Gate;
9. bootstrap `clone → build/download → query`;
10. E2E com duas branches alterando serviços diferentes;
11. publicação opcional de SQLite gerado;
12. épico posterior de indexação incremental.

### Critérios de aceite

- dois devs podem adicionar serviços diferentes sem conflito binário global;
- PR mostra diff semântico completo;
- importar o mesmo manifest em duas máquinas produz as mesmas identidades e respostas;
- nenhum path absoluto entra nos objetos;
- SQLite pode ser apagado e reconstruído;
- objects e refs divergentes falham fechado;
- baseline não aceito nunca vira ref corrente;
- mudança de source revision invalida derivados dependentes;
- CI detecta SQLite que não corresponde ao manifest;
- o fluxo funciona sem banco compartilhado ou serviço sempre ligado.

---

## 8. Ordem crítica recomendada

```text
Concluir v2 + F1-F4
  ↓
Git object/ref/manifest contracts + ADR
  ↓
Export/import round-trip + semantic diff + SQLite builder
  ↓
QueryRequest contract
  ↓
Query Interpreter
  ↓
Portable Evidence contract + RepoBinding
  ↓
Context Hydrator + ContextLoadReceipt
  ↓
AgentContextEnvelope
  ↓
Task Agent
  ↓
Citation Validator + TaskOutcome
  ↓
Feedback overlays
  ↓
Evals, segurança, métricas e rollout completo
```

Evals e segurança começam junto com o primeiro contrato e bloqueiam cada promoção de fase.

---

## 9. Decisões registradas

1. Skills L0/L1/L2/Slice/Pack continuam determinísticas; chamadas a modelos ficam no runtime do agente.
2. Query Interpreter e Task Agent são os únicos novos estágios LLM obrigatórios.
3. Context Hydrator é uma camada determinística entre Pack e LLM.
4. Evidence persiste somente identidade lógica e paths relativos ao repo.
5. Paths absolutos e RepoBindings nunca entram em payload canônico ou hashes.
6. Eager hydration carrega seeds/caminho crítico; lazy hydration expande pointers secundários.
7. Toda resposta factual cita evidence IDs previamente hidratadas.
8. O runtime gera ContextLoadReceipt e valida citações.
9. Carga inicial usa modelos baratos em Batch; execução usa modelo balanced com promoção sob evidência.
10. Verificação usa modelo forte e preferencialmente independente do executor.
11. Git versiona objetos/refs canônicos e semanticamente revisáveis.
12. SQLite é um índice local gerado, não a única fonte de verdade colaborativa.
13. `manifest.lock` fecha o snapshot arquitetural distribuído.
14. PR + CI + CODEOWNERS implementam o Human Gate corporativo.
15. Atualização incremental é posterior ao round-trip reprodutível.

---

## 10. Fontes primárias para modelos e preços

Consultadas em 2026-08-07:

- OpenAI: [Pricing](https://developers.openai.com/api/docs/pricing), [Models](https://developers.openai.com/api/docs/models), [Structured Outputs](https://developers.openai.com/cookbook/examples/structured_outputs_intro), [Programmatic Tool Calling](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling).
- Anthropic: [Pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Models](https://platform.claude.com/docs/en/about-claude/models/overview), [Message Batches](https://platform.claude.com/docs/en/build-with-claude/batch-processing).
- Google: [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini 3](https://ai.google.dev/gemini-api/docs/gemini-3), [Batch API](https://ai.google.dev/gemini-api/docs/batch-api), [Function calling](https://ai.google.dev/gemini-api/docs/function-calling).
- xAI: [Pricing](https://docs.x.ai/developers/pricing), [Models](https://docs.x.ai/developers/models).
- DeepSeek: [Models and pricing](https://api-docs.deepseek.com/quick_start/pricing/).

Preços e disponibilidade não são decisões arquiteturais. O contrato por fase e os critérios de promoção são duráveis; o modelo concreto deve ser revisado antes de cada rollout.
