# Fluxo: Descobrir

**Versão:** 1.0  
**Status:** approved — Gate A em 2026-08-02  
**Glossário:** `docs/domain/glossary.md`

---

## Propósito

Transformar um Repositório em um conjunto verificável de Knowledge Records e Relations, ancorado em uma revisão explícita, preservando in-place os Native Artifacts do Discovery Engine como proveniência da indexação (manifesto com path relativo, hash e metadados; bytes brutos permanecem no Contexto-alvo).

Ao final, o grafo candidato contém fatos determinísticos com Artifact References e, quando resolvíveis e verificados, Repository References; Relations tipadas entre entidades; um Artifact Manifest rastreando os artefatos de origem; um GraphIndex com `canonical_graph_hash`; e um baseline candidate com reconciliação frente às métricas declaradas pelo produtor. A publicação no Knowledge Namespace aceito ocorre somente após aprovação no Human Gate.

Este documento é o contrato do fluxo. Não descreve runtime, comandos, tecnologia de armazenamento, modelos, agentes específicos ou orçamento.

---

## Gatilho

Marley decide que um Repositório de um Projeto já registrado no harness precisa ter seu conhecimento estrutural indexado no Project Knowledge Graph.

---

## Entradas obrigatórias

| Entrada | Descrição |
|---|---|
| Identidade lógica do Repositório | Identificador estável, independente de path |
| Revisão-alvo | Revisão exata a ser indexada; sem ela, a carga não começa |
| Contexto de execução | Ambiente onde o fluxo será realizado |
| Knowledge Namespace de destino | Namespace do Projeto onde os registros serão persistidos após aprovação |
| Responsável pela decisão | Quem aprovará o baseline candidate (sempre Marley) |

---

## Guardrails

- Código-fonte não é enviado para fora do Contexto por padrão.
- Native Artifacts são não confiáveis (untrusted). Preservação v1 é in-place: o Artifact Manifest registra path relativo, hash e metadados; bytes brutos permanecem no Contexto-alvo e **não** são copiados para saída do harness nem para o baseline.
- Afirmações que apontam para um Native Artifact usam Artifact Reference no shape `{kind:"artifact",manifest_id,artifact_path,content_sha256,range}`; Repository Reference aponta exclusivamente para código-fonte na revisão fixada do Repositório.
- Afirmações sem Repository Reference resolvível e verificada permanecem `hipótese` (incluindo evidência apenas de artefato).
- Evidência não comprovada é marcada como `hipótese`, nunca como fato.
- Evidências contraditórias não são selecionadas silenciosamente: os registros/relações afetados recebem **status** `contradição` (nunca um flag separado). Nenhuma versão é promovida a canônica até resolução explícita.
- Todo registro ou relação com status `comprovado` deve ter a **própria** Repository Reference verificada contra o código na revisão-âncora. Amostragem na fase 5 é auditoria de qualidade, não mecanismo de promoção em lote.
- Unverified Projections — diagramas, resumos e qualquer derivação não rastreável a um Native Artifact ou a código — nunca são tratadas como entrada factual.
- Paths de máquina não formam identidade canônica; Repository Resolvers fazem esse mapeamento e permanecem apenas em configuração efêmera do resolver.
- IDs de Knowledge Record e Relation são únicos **dentro** do Knowledge Namespace. Persistência e Relations não cruzam namespaces. O `namespace` de uma Relation deve coincidir com o dos records conectados e com o namespace da carga.
- O repositório-alvo nunca é mutado. Evidência de código vem da revisão pinada, nunca de bytes da working tree.
- Nunca persistir em records, summary, attributes, reports ou logs: segredos, valores de env, connection strings, payloads brutos de código, paths absolutos ou conteúdo de arquivos dirty.
- Leituras de artefato devem rejeitar symlinks que escapem a raiz permitida (confinamento por path resolvido).
- O baseline candidate registra a revisão exata do Repositório no momento da carga. Status `stale` existe no enum para consumo por checagens de freshness posteriores; v1 apenas registra `source_revision` e **não** implementa atualizador incremental.
- Consenso entre agentes não substitui aprovação humana em Human Gates.

---

## Fases

### Fase 1 — Resolver fonte

**Entrada:** identidade lógica do Repositório; revisão-alvo; Contexto de execução.

**Ação:** confirmar que o Repositório possui um Repository Resolver configurado para o Contexto atual. Mapear a identidade lógica ao path real sem inscrevê-lo como identidade canônica (path de máquina fica só na config efêmera do resolver). Verificar que a revisão-alvo está acessível e legível no Contexto. O código na revisão pinada é a fonte evidencial; o Project Knowledge Graph é o índice factual operacional derivado dessa evidência.

**Saída:** Repository Resolver confirmado; revisão-alvo verificada e anotada como âncora da carga.

**Caminho de falha:** se o Repositório não tiver resolver configurado para o Contexto atual, ou se a revisão-alvo não estiver acessível, o fluxo para e registra o bloqueador. Nenhuma extração começa enquanto a fonte não estiver resolvível.

---

### Fase 2 — Obter artefatos nativos

**Entrada:** Repository Resolver confirmado; revisão-alvo anotada.

**Ação:** verificar se já existe um conjunto de Native Artifacts produzido por um Discovery Engine cuja revisão declarada corresponde exatamente à revisão-alvo. Se existir, reutilizá-lo integralmente sem nova execução (`acquisition_mode: reused`). Caso contrário, invocar o Discovery Engine adequado ao tipo de Repositório para produzir os Native Artifacts — índices, grafos intermediários, relatórios estruturais — no formato que lhe é natural (`acquisition_mode: fresh`). Em ambos os casos, os Native Artifacts são tratados como untrusted e preservados in-place: o Artifact Manifest lista cada artefato com path relativo, hash de conteúdo, tipo/role, revisão declarada e `acquisition_mode`; os bytes brutos **não** são copiados para o harness. O manifesto representa o conjunto atual de artefatos desta carga — não um histórico de múltiplas execuções da engine.

**Saída:** Native Artifacts identificados por revisão e por produtor; Artifact Manifest inicial com `acquisition_mode` (`reused`|`fresh`) e inventário de cada artefato (path relativo, hash, metadados).

**Caminho de falha:** se nenhum Native Artifact reutilizável estiver disponível e o Discovery Engine não suportar o tipo de Repositório ou falhar durante a execução, o fluxo para. Os artefatos parciais, se existirem, são registrados no Artifact Manifest com status `incompleto`. O fluxo não avança para adaptação enquanto a obtenção não concluir ou enquanto não houver decisão explícita de Marley para prosseguir com cobertura parcial.

---

### Fase 3 — Adaptar artefatos nativos

**Entrada:** Native Artifacts obtidos na fase anterior; Artifact Manifest inicial.

**Ação:** percorrer os Native Artifacts por meio de Artifact Adapters e extrair as entidades e relações estruturalmente inferíveis: módulos, serviços, contratos, dependências, endpoints, schemas, eventos e configuração de deploy. Cada entidade extraída é mapeada para um Knowledge Record tipado. Cada relação entre entidades é registrada como uma Relation separada com tipo canônico e referências às entidades conectadas. Toda afirmação recebe uma Artifact Reference no shape `{kind:"artifact",manifest_id,artifact_path,content_sha256,range}`, onde `artifact_path` obedece às mesmas restrições de path relativo do manifesto e resolve para um artefato listado com hash correspondente. Quando a declaração de origem for rastreável a uma localização no código-fonte do Repositório na revisão-alvo, acrescenta-se também uma Repository Reference. Afirmações com apenas Artifact Reference, sem Repository Reference resolvível e verificada, permanecem marcadas como `hipótese`. Leituras de artefato aplicam confinamento de path (realpath dentro da raiz permitida; rejeitar symlink escape). Os Native Artifacts permanecem intactos no Contexto-alvo; os Artifact Adapters apenas lêem, nunca reescrevem nem copiam corpos para a saída do harness.

**Saída:** Knowledge Records tipados com Artifact References e, onde resolvíveis, Repository References; Relations canônicas entre entidades; cada record/relation referencia o Artifact Manifest e o Native Artifact de origem.

**Caminho de falha:** se um Native Artifact não tiver Artifact Adapter disponível para seu tipo, nenhuma entidade é emitida a partir dele; o artefato permanece inventariado e o gap é registrado no Artifact Manifest e na reconciliação com o produtor. O fluxo continua para os demais artefatos.

---

### Fase 4 — Normalizar referências

**Entrada:** Knowledge Records e Relations produzidos na fase anterior.

**Ação:** atribuir identificadores canônicos estáveis e únicos dentro do Knowledge Namespace a cada Knowledge Record (`type:natural_key`) e a cada Relation (ID determinístico e type-prefixed a partir de `relation_type` + `from_record` + `to_record`). Verificar que o `namespace` de cada Relation coincide com o dos records conectados e com o namespace da carga. Verificar que toda Artifact Reference aponta para o Native Artifact correto no manifesto (path + hash) e que toda Repository Reference segue o formato independente de máquina e aponta para a revisão-âncora da carga. Substituir qualquer referência a path absoluto por Repository Reference resolvível (ou remover e manter `hipótese`). Registrar em cada Knowledge Record e Relation a revisão do Repositório em que o fato foi observado e o `source_engine` estrutural (`name`, `profile`, `adapter_version`, `artifact_manifest_id`). Metadados exclusivos da execução — timestamp da carga, run id e `acquisition_mode` — ficam no Artifact Manifest, não nos registros individuais.

**Saída:** Knowledge Records e Relations com IDs canônicos e revisão de origem anotada; Artifact References e Repository References no formato canônico; Artifact Manifest atualizado com metadados de execução da carga.

**Caminho de falha:** se uma Repository Reference não puder ser construída porque a localização de origem no Repositório é ambígua ou ausente, o registro afetado permanece com apenas Artifact Reference e status `hipótese`, e o gap é anotado no relatório de cobertura. O fluxo não bloqueia.

---

### Fase 5 — Validar evidências

**Entrada:** Knowledge Records e Relations normalizados; Artifact Manifest completo.

**Ação:**

1. **Promoção individual a `comprovado`:** para cada Knowledge Record e cada Relation, o status `comprovado` só é atribuído se a **própria** evidência incluir Repository Reference resolvível e verificada contra o código na revisão-âncora. Evidência apenas de artefato permanece `hipótese`. Registros cujas fontes apresentam afirmações incompatíveis entre si recebem **status** `contradição` (não flag); nenhuma versão é promovida como canônica até resolução explícita.

2. **Auditoria por amostragem:** amostrar um subconjunto dos Knowledge Records/Relations e revalidar contra a fonte declarada (Artifact Reference e, quando presente, Repository Reference). A amostragem é auditoria de qualidade do processo; **não** promove nem rebaixa em lote registros fora da amostra. Divergências encontradas na amostra são gaps no relatório.

3. **Repeatability do índice do Adapter:** Repeatability é propriedade do índice produzido pelo Artifact Adapter para bytes idênticos de Native Artifact + mesma `source_revision`. Compara Records/Relations canônicos **incluindo** evidence e status, **excluindo** metadados narrativos/observacionais (summary prose opcional fora do canônico, timestamps, run ids). O GraphIndex carrega `canonical_graph_hash` sobre o conjunto canônico completo e estruturado de Records e Relations; o resultado de Repeatability compara esse hash. Manifest id e hashes brutos de artefato **não** substituem o conteúdo do grafo. Reexecutar a Discovery Engine ou divergência de hashes entre engines **não** faz parte deste gate v1.

4. **Provenance Coverage:** calcular o conjunto de métricas de Provenance Coverage (definição única):
   - `artifact_reference_percentage` — proporção de records/relations com Artifact Reference válida (manifest_id + path resolvível no manifesto + content_sha256 correspondente + range);
   - `repository_verified_percentage` — proporção de records/relations com Repository Reference verificada na revisão pinada **e** status `comprovado`.
   Artefato-only permanece `hipótese` e não conta em `repository_verified_percentage`.

**Saída:** GraphIndex com listas ordenadas de IDs e `canonical_graph_hash`; relatório de cobertura com Provenance Coverage (`artifact_reference_percentage`, `repository_verified_percentage`), histograma de status (incluindo `contradição` e `stale`), lista de lacunas, resultado de Repeatability e insumos para reconciliação com o produtor.

**Caminho de falha:** se a verificação de Repeatability revelar divergência no `canonical_graph_hash` para a mesma entrada (mesmos bytes de Native Artifact + mesma revisão), o fluxo para e registra o bloqueador. Baseline candidate não avança enquanto a indexação não produzir estrutura canônica equivalente.

---

### Fase 6 — Preparar baseline candidate

**Entrada:** Knowledge Records e Relations validados; GraphIndex; relatório de cobertura parcial; Artifact Manifest final.

**Ação:** montar o **baseline candidate** — pacote versionado com Knowledge Records, Relations, GraphIndex, Artifact Manifest e relatório de cobertura completo — **sem** publicar no namespace aceito. Registrar a revisão-âncora do Repositório como ponto de referência do candidate. Realizar a reconciliação com o produtor: comparar as contagens e métricas declaradas pelo Discovery Engine nos Native Artifacts com as contagens efetivamente indexadas; cada delta exige `explanation` não vazia; o bloco `producer_baseline` registra `result: pass|fail`. Avaliar o limiar (`threshold`) com booleanos obrigatórios de schema, repeatability, mutation e producer reconciliation, mais o mínimo de `repository_verified_percentage`. O campo `passed` do relatório é o invariante de implementação que combina esses booleanos e o mínimo de cobertura verificada. Evidência de mutação pré/pós do repositório-alvo deve ser equivalente (alvo não mutado).

**Saída:** baseline candidate (ainda não aceito); Artifact Manifest versionado do candidate; GraphIndex; relatório de cobertura com reconciliação do produtor, mutation equivalence e `passed`.

**Caminho de falha:** se `passed` for false — cobertura `repository_verified_percentage` abaixo do limiar, schema inválido, repeatability fail, mutation não equivalente, ou delta de reconciliação com produtor sem explicação / `result: fail` — o baseline candidate não é elegível ao Human Gate de aprovação. O fluxo retorna à fase 5 para ampliar verificação ou à fase 3 para rever a adaptação dos artefatos problemáticos. Em nenhum caso o namespace aceito é alterado nesta fase.

---

## Human Gate — Aprovação do baseline candidate

**Posição:** após a fase 6 (Preparar baseline candidate). O candidate **não** está no namespace aceito até esta decisão.

**O que Marley revisa:**

- Relatório de cobertura: Provenance Coverage (`artifact_reference_percentage`, `repository_verified_percentage`), histograma de status, lacunas, registros/relações com status `hipótese` ou `contradição`.
- Amostras de proveniência: Knowledge Records e Relations selecionados com suas Artifact References e Repository References, verificando que cada referência aponta para a declaração de origem correta na revisão-âncora.
- GraphIndex e resultado de Repeatability: `canonical_graph_hash` equivalente para a mesma entrada (bytes de Native Artifact + revisão).
- Metadados de execução no Artifact Manifest: revisão-âncora, identificador do Discovery Engine e `acquisition_mode` (`reused`|`fresh`).
- Relatório de reconciliação com o produtor: contagens declaradas versus indexadas, deltas com explanation não vazia, `producer_baseline.result`.
- Mutation: equivalência pré/pós do repositório-alvo.
- `passed` e os booleanos de `threshold`.

**Decisões disponíveis:**

| Decisão | Consequência |
|---|---|
| Aprovar | Publicação/aceitação **atômica**: o baseline candidate torna-se o baseline aceito no Knowledge Namespace de destino; fluxo conclui |
| Rejeitar com ajuste | Especificar quais registros, gaps ou lacunas precisam ser corrigidos; fluxo retorna à fase indicada; namespace aceito permanece inalterado |
| Rejeitar e cancelar | Baseline candidate descartado; Knowledge Namespace aceito permanece no estado anterior à carga |

Aprovação de Marley é necessária para publicar no namespace aceito, mas não substitui as evidências nem libera blockers pendentes (`passed` deve ser true). Consenso entre agentes também não substitui essa aprovação. Rejeição **nunca** altera o namespace aceito pré-existente.

---

## Saídas do fluxo

| Saída | Descrição |
|---|---|
| Knowledge Records tipados | Fatos determinísticos extraídos, normalizados, com IDs canônicos únicos no namespace, Artifact References e, onde verificados, Repository References |
| Relations canônicas | Relações tipadas entre entidades, IDs determinísticos type-prefixed, namespace alinhado aos records e à carga |
| GraphIndex | Índice canônico com IDs ordenados e `canonical_graph_hash` sobre Records/Relations estruturados completos |
| Artifact Manifest versionado | Inventário in-place dos Native Artifacts (path relativo, hash, metadados, `acquisition_mode`); sem cópia de corpos |
| Baseline candidate → baseline aceito | Após Human Gate: Project Knowledge Graph no namespace com baseline aceito; antes do gate, apenas candidate |
| Relatório de cobertura e lacunas | Provenance Coverage (duas taxas), histograma de status, unresolved IDs, Repeatability, mutation, threshold, `passed` |
| Relatório de reconciliação com o produtor | Contagens declaradas versus indexadas, deltas com explanation, `result: pass|fail` |

---

## Semântica de falha — resumo

| Falha | Fase | Comportamento |
|---|---|---|
| Resolver ausente ou revisão inacessível | 1 | Bloqueador: fluxo não avança para obtenção de artefatos |
| Discovery Engine falhou ou artefatos incompletos | 2 | Bloqueador: aguarda conclusão ou decisão explícita de Marley |
| Native Artifact sem Artifact Adapter | 3 | Não bloqueador: nenhuma entidade emitida; artefato inventariado e gap na reconciliação com o produtor |
| Artifact Reference não construível / path inválido | 3 | Não bloqueador: entidade não emitida; gap no relatório de cobertura e na reconciliação com o produtor |
| Repository Reference não resolvível | 4 | Não bloqueador: registro permanece com apenas Artifact Reference e status `hipótese`, gap no relatório |
| Evidência contraditória | 5 | Não bloqueador: registros/relações com **status** `contradição`, nenhum promovido como canônico |
| Repeatability comprometida (`canonical_graph_hash`) | 5 | Bloqueador: baseline candidate não avança até indexação produzir estrutura canônica equivalente |
| Delta de reconciliação com produtor sem explanation / result fail | 6 | Bloqueador: retorna à fase 5 ou 3 para correção; namespace aceito inalterado |
| `passed` false (schema, repeatability, mutation, cobertura, producer) | 6 | Bloqueador: candidate não elegível ao gate de aprovação; namespace aceito inalterado |
| Baseline candidate rejeitado por Marley | Human Gate | Retorna à fase indicada ou mantém estado anterior do namespace aceito |
