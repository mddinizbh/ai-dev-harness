# Glossário — Project Onboarding

> Subconjunto do vocabulário do domínio necessário para ler `workflows/project-onboarding/FLOW.md`.
> Sem detalhes de implementação. Decisões técnicas vivem em `docs/adr/`.

---

## Entidades de ambiente

### Harness
Camada de composição sobre o runtime de agentes que adiciona skills, fluxos versionados, Context Layer e memória entre sessões. Portátil entre Contextos; não é um runtime novo.

### Contexto
Ambiente onde o harness roda. Define código acessível, modelos disponíveis, restrições de rede e convenções locais. Exemplos: Mac pessoal, VDI corporativa.

### Workspace
Local físico onde o desenvolvedor trabalha, podendo conter um ou vários Projetos e Repositórios. Paths de Workspace são específicos de cada máquina e não formam identidade canônica na Context Layer.

### Projeto
Sistema ou produto lógico com objetivo e contexto arquitetural próprios. Pode ser composto por um ou vários Repositórios. Diferente do Workspace, que é físico, o Projeto é uma fronteira lógica e permanente.

### Repositório
Unidade de versionamento de código ou infraestrutura que pertence a um Projeto. Possui identidade lógica estável e pode estar clonado em paths diferentes conforme o Contexto, sem perder sua identidade.

---

## Configuração do projeto

### Project Profile
Pacote que adapta o harness a um Projeto específico. Reúne referências ao Project Knowledge Graph, políticas de dados, regras, ferramentas disponíveis e convenções do repositório.

---

## Fluxo de onboarding

### Project Onboarding
Fluxo reutilizável que registra um Projeto, define suas fronteiras e políticas, executa o Initial Knowledge Load e comprova que agentes conseguem consultar o conhecimento publicado. Depois de concluído, o Projeto passa a usar atualizações incrementais.

### Initial Knowledge Load
Carga completa executada ao cadastrar um Projeto pela primeira vez. Descobre Repositórios, extrai fatos determinísticos, enriquece relações semânticas, valida amostras contra as fontes e publica um baseline versionado no Project Knowledge Graph.

---

## Context Layer (base de conhecimento)

### Project Knowledge Graph
Representação navegável e verificável de um Projeto: serviços, módulos, contratos, endpoints, dados, dependências e evidências de origem. É o **índice factual operacional** do projeto. A fonte evidencial subjacente é o código-fonte do Repositório em revisão lógica fixada; o grafo deriva e indexa fatos verificáveis a partir dessa evidência. Pode ser atualizado incrementalmente em fluxos posteriores e sinaliza conhecimento potencialmente obsoleto. O grafo é o todo; o Namespace é sua fronteira; o Record é sua unidade de entidade; a Relation é o vínculo tipado separado.

### Knowledge Namespace
Fronteira de isolamento dentro da Context Layer. Cada Projeto possui um namespace próprio; selecionar um Projeto numa sessão autoriza somente aquele conhecimento. Cruzamento entre projetos ou empregadores é proibido por padrão. IDs de Knowledge Record e Relation são únicos dentro do namespace; persistência e Relations não cruzam namespaces.

### Knowledge Record
Unidade persistente de **entidade** na Context Layer. Possui identidade estável (única no namespace), namespace, tipo, conteúdo, validade e evidências de origem. **Relações entre entidades não ficam embutidas no Record** — vivem em registros Relation separados. Exemplos de Record: serviço, contrato, decisão, jornada, resultado de teste.

### Knowledge Freshness
Estado que informa em qual revisão uma descoberta foi observada e se a evidência ainda corresponde ao código atual. O status `stale` marca que o código avançou além da `source_revision` observada; agentes devem revalidá-lo antes de usá-lo em decisões críticas. Em Descobrir v1, cada registro carrega `source_revision`; checagens de freshness que consomem `stale` e atualizadores incrementais ficam para fluxos posteriores — v1 não implementa updater incremental.

---

## Referências a código

### Repository Reference
URI independente de máquina que aponta para evidência no código, incluindo repositório lógico, revisão, arquivo e intervalo relevante. Formato: `repo://<repositório-lógico>@<revisão>/<caminho>#L<início>-L<fim>`. Path segments proíbem percent-encoding e caracteres reservados `% ? # @`. Código-fonte não precisa ser copiado para a Context Layer. Contrato normativo: `workflows/descobrir/contracts/repo-reference.md`.

### Repository Resolver
Mapeamento local entre um repositório lógico e seu caminho real em cada Contexto. Permite que a mesma Repository Reference funcione em ambientes distintos sem registrar paths específicos da máquina. Paths de máquina permanecem apenas na configuração efêmera do resolver.

---

## Consulta e entrega de conhecimento

### Context Gateway
Porta de entrada usada pelos agentes para consultar a Context Layer. Recebe projeto, intenção e orçamento; aplica a Data Boundary Policy; recupera apenas evidências relevantes; e produz um Context Slice mínimo.

### Context Slice
Subgrafo materializado de forma determinística a partir do Project Knowledge Graph aceito, sob uma política de traversal explícita e âncoras (seeds) normalizadas. O Slice é **completo relativamente ao grafo indexado**: contém todos os nós, arestas, misses e cobertura exigidos pela política, não um recorte mínimo. É dado derivado **content-addressed**: o `slice_hash` é SHA-256 sobre o payload canônico (seeds, baselines, nós, arestas, misses, cobertura, provenance), excluindo envelopes de auditoria (`audit.created_at`, `audit.updated_at`, `materialization_ms`) populados apenas pela camada de persistência. A mesma *derivation key* (seeds normalizadas + política + versões + hashes de baseline aceitos + opções) sempre produz o mesmo Slice. Orçamentos de tokens/nós/arestas **não** se aplicam aqui — eles pertencem ao *Context Pack*. Falta de indexação, dispatch não resolvido, âncoras incertas e fronteiras de política são emitidas explicitamente como *misses*; a completude é sempre relativa ao que está indexado. Contrato normativo: `skills/explorer-query/contracts/context-slice.schema.json`.

### Context Pack
Projeção **orçada** derivada de um Context Slice completo, pronta para consumo por um agente. É aqui — não no Slice — que orçamentos de tokens, nós e arestas aplicam-se: o Pack pode ser truncado (`truncated: true`) quando atinge o orçamento, mas ainda carrega as seeds normalizadas, o resumo da derivation key e contadores de cobertura do Slice de origem. Como o Slice, é content-addressed (`pack_id` = `pack:` + SHA-256 do payload canônico do Pack). Campos de relógio (`generated_at`, durações) vivem apenas em propriedades de envelope CLI não-hasheadas, nunca no payload canônico do Pack. O Context Gateway entrega um Pack (mínimo relativo ao orçamento solicitado) derivido de um Slice completo. Contrato normativo: `skills/explorer-query/contracts/context-pack.schema.json`.

---

## Políticas e aprovação

### Data Boundary Policy
Regras que definem o que pode sair de um Contexto, ser armazenado remotamente ou compartilhado com outro namespace. Conhecimento corporativo não é promovido automaticamente; apenas padrões genéricos, sanitizados e explicitamente aprovados podem cruzar fronteiras. Em Descobrir v1: nunca persistir segredos, env, connection strings, payloads brutos de código, paths absolutos ou conteúdo de arquivos dirty em records, summary, attributes ou reports.

### Human Gate
Ponto explícito onde a execução pausa e aguarda ação autorizada do responsável pela decisão: aprovar configuração, aceitar risco ou liberar a próxima fase. Consenso entre agentes não substitui essa aprovação. No Descobrir, a aprovação do baseline candidate publica atomicamente no namespace aceito; rejeição deixa o namespace anterior inalterado.

### Verification Evidence
Prova executável de que um resultado funciona: saída de testes, chamadas E2E, logs, resposta HTTP, consulta de banco ou evento publicado/consumido. Afirmações de sucesso sem evidência não concluem uma fase do onboarding.

---

## Descobrir (indexação determinística)

> Subconjunto do vocabulário necessário para ler `workflows/descobrir/FLOW.md`.
> Termos já definidos acima são referenciados, não redefinidos.

### Descobrir
Fluxo que transforma um Repositório em um conjunto verificável de Knowledge Records e Relations, ancorado em uma revisão explícita. Preserva in-place os artefatos nativos da skill de descoberta como proveniência da indexação e produz um baseline candidate que só se torna baseline aceito após Human Gate.

### Discovery Engine
Skill que opera sobre um Repositório e produz artefatos nativos estruturados a partir do código-fonte na revisão-alvo. Não é a fonte factual de verdade: essa posição evidencial pertence ao próprio Repositório na revisão pinada; a Discovery Engine apenas torna o conteúdo navegável em um formato indexável. O Project Knowledge Graph é o índice factual operacional derivado.

### Artifact Adapter
Componente que lê artefatos nativos e extrai entidades e relações mapeáveis para Knowledge Records e Relations canônicas. Nunca reescreve o artefato de origem; sua função é exclusivamente leitura e transformação. O índice que ele produz é o objeto da Repeatability v1.

### Native Artifact
Saída direta de uma Discovery Engine no formato que lhe é natural: índices, grafos intermediários, relatórios estruturais. É **untrusted**. Preservação v1 é in-place: path relativo, hash e metadados no Artifact Manifest; bytes brutos permanecem no Contexto-alvo e não são copiados para a saída do harness nem para o baseline. Conteúdo não é alterado durante a adaptação.

### Artifact Manifest
Inventário versionado que lista cada Native Artifact da carga atual, com path relativo, hash de conteúdo, role, revisão declarada, status e `acquisition_mode` (`reused`|`fresh`). Representa o conjunto atual de artefatos — não o histórico de múltiplas execuções da engine. O ID do manifesto é content-addressed a partir do conjunto atual de artefatos (namespace, logical_repo, source_revision, engine/profile, hashes ordenados) e exclui acquisition_mode, timestamps e run ids. Cada Knowledge Record ou Relation aponta para esse manifesto e para o artefato de origem por sua Evidence.

### GraphIndex
Índice canônico de uma carga Descobrir: listas ordenadas de IDs de Knowledge Records e Relations, contagens e `canonical_graph_hash` calculado sobre o conjunto canônico completo e estruturado de Records e Relations (incluindo evidence e status; excluindo metadados narrativos/observacionais). É a âncora da verificação de Repeatability.

### Canonical ID
Identificador estável atribuído a um Knowledge Record ou Relation, único dentro do Knowledge Namespace. Exclui path de máquina e revisão, de modo que a identidade sobreviva a reindexações e migrações de ambiente. Dois registros com o mesmo Canonical ID no mesmo namespace representam o mesmo fato lógico.

**id_version=2 (ADR 0009)** — todo novo ID carrega um prefixo de camada explícito e é produzido pelo módulo compartilhado `skills/explorer-l0/src/layered-id.mjs`. Veja a tabela **Layered ID decoder ring** abaixo para o mapeamento v1↔v2.

### Layered ID decoder ring (ADR 0009)

Toda nova identidade produzida pelo pipeline usa `ID_VERSION=2`. IDs legados sem prefixo de camada são reconhecidos como `id_version=1`; leitores v2 rejeitam mistura v1+v2 com `MixedVersionError`.

| Camada | Identidade | v2 (atual) | v1 (legado, somente leitura) |
| --- | --- | --- | --- |
| L0 record | Knowledge Record | `l0:<record-kind>:<canonical-natural-key>` | `<type>:<natural_key>` |
| L0 relation | Relation | `l0:rel:<RELATION_TYPE>:<from-natural-key>-><to-natural-key>` (natural keys no corpo) | `<type>:<from_record>-><to_record>` (record ids no corpo) |
| L0 FrontierFact | FrontierFact | `l0:ff:<kind>:<16-hex-sha256>` | `ff:<kind>:<16-hex-sha256>` ou `ff:<short-kind>:<32-bit>:<line>` |
| L1 edge | SystemEdge | `l1:edge:<32-hex-sha256>` | `l1:<32-hex-sha256>` |
| L2 journey | JourneySpec id | `l2:journey:<journey-id>` | `<journey-id>` cru |
| L2 bind | JourneyBind id | `l2:bind:<32-hex-sha256>` | `<ns>:<journeyId>:<journeyHash>` |
| Slice | Context Slice id | `slice:<64-hex>` | `slice:<64-hex>` (formato estável; hash muda) |
| Pack | Context Pack id | `pack:<64-hex>` | sem `pack_id` determinístico |

Larguras de hash pré-existentes são **preservadas** (16 hex ff, 32 hex L1/L2, 64 hex Slice/Pack). `ID_VERSION` entra no material de cada hash, então mudar apenas a versão invalida todos os hashes downstream. Endpoints de Relation persistidos continuam armazenando o L0 record id completo (`l0:<kind>:*`); apenas o **corpo do ID** carrega natural keys. Endpoints L1 sempre referenciam `l0:ff:*`, nunca um L0 record id direto.

### Relation
Vínculo tipado entre duas entidades no Project Knowledge Graph, persistido como registro **separado** (nunca embutido em KnowledgeRecord.attributes). Possui ID canônico type-prefixed, namespace (deve coincidir com o dos records conectados e com o da carga), tipo canônico, referências às entidades conectadas, status, source_revision e evidence. Persistência e Relations não cruzam namespaces.

### Artifact Reference
Referência independente de máquina no shape exato `{kind:"artifact", manifest_id, artifact_path, content_sha256, range}`. Aponta para um intervalo dentro de um Native Artifact listado no Artifact Manifest. `artifact_path` usa as mesmas restrições estritas de path relativo das entradas do manifesto e deve resolver para um artefato com hash correspondente. Difere de *Repository Reference*, que sempre aponta para código-fonte.

### Provenance Coverage
Conjunto de métricas de proveniência de uma carga, com **duas taxas** (definição única em todo o contrato):

1. **`artifact_reference_percentage`** — proporção de Knowledge Records e Relations que possuem Artifact Reference válida (manifest_id presente, `artifact_path` resolvível no manifesto, `content_sha256` correspondente, range bem formado).
2. **`repository_verified_percentage`** — proporção de Knowledge Records e Relations que possuem Repository Reference verificada contra o código na revisão pinada **e** status `comprovado`.

Evidência apenas de artefato permanece `hipótese` e não eleva `repository_verified_percentage`. Amostragem de auditoria não substitui verificação individual para promoção a `comprovado`.

### Repeatability
Propriedade do **índice produzido pelo Artifact Adapter** para bytes idênticos de Native Artifact + mesma `source_revision`. Compara Records e Relations canônicos **incluindo** evidence e status, **excluindo** metadados narrativos/observacionais (timestamps, run ids, prosa não estrutural). O GraphIndex carrega `canonical_graph_hash` sobre esse conjunto canônico completo; o resultado de Repeatability compara esse hash. Manifest id e hashes brutos de artefato não substituem o conteúdo do grafo. Reexecução da Discovery Engine ou divergência de hashes entre engines **não** faz parte do gate de Repeatability v1.

### Unverified Projection
Artefato derivado do Project Knowledge Graph, como diagramas ou relatórios, produzido para consumo humano e não rastreado como evidência factual. Projeções não verificadas são descartáveis e não podem ser usadas como entrada factual em fases subsequentes do fluxo.

> **Referências cruzadas:** *Knowledge Record*, *Repository Reference*, *Repository Resolver* e *Knowledge Freshness* estão definidos na seção **Context Layer (base de conhecimento)** e **Referências a código** acima.
