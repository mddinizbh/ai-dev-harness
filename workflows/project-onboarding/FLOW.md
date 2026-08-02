# Fluxo: Project Onboarding

**Versão:** 1.0  
**Status:** draft  
**Glossário:** `docs/domain/glossary.md`

---

## Propósito

Registrar um Projeto no harness, definir suas fronteiras e políticas, executar o Initial Knowledge Load e comprovar que agentes conseguem consultar o conhecimento publicado. Ao final, o Projeto está pronto para receber atualizações incrementais.

Este documento é o contrato do fluxo. Não descreve runtime, comandos, tecnologia de armazenamento, modelos, agentes específicos ou orçamento.

---

## Gatilho

Marley decide que um Projeto de qualquer Workspace deve ficar disponível para sessões e agentes do harness.

---

## Entradas obrigatórias

| Entrada | Descrição |
|---|---|
| Nome lógico do Projeto | Identificador estável, independente de path |
| Lista de Repositórios | Identidades lógicas dos repositórios que compõem o Projeto |
| Contexto de execução | Ambiente onde o onboarding será realizado |
| Classificação de sensibilidade | Nível de proteção dos dados do Projeto |
| Responsável pela decisão | Quem aprovará o baseline (sempre Marley) |

---

## Guardrails

- Código-fonte não é enviado para fora do Contexto por padrão.
- Toda afirmação arquitetural aponta para uma Repository Reference com revisão explícita.
- Conhecimento não comprovado é marcado como hipótese, nunca como fato.
- O baseline registra a revisão exata de cada Repositório no momento da carga.
- Nenhum dado cruza fronteiras de namespace sem Data Boundary Policy explícita.
- Paths de máquina não formam identidade canônica; Repository Resolvers fazem esse mapeamento.
- Consenso entre agentes não substitui aprovação humana em Human Gates.

---

## Fases

### Fase 1 — Registrar fronteira

**Entrada:** nome lógico do Projeto, lista de Repositórios, Contexto de execução, responsável pela decisão.

**Ação:** criar o Project Profile com as fronteiras do Projeto, listar os Repositórios que pertencem a ele e registrar o responsável pela aprovação do baseline.

**Saída:** Project Profile em rascunho; lista canônica de Repositórios do Projeto.

**Caminho de falha:** se o nome lógico do Projeto já existir em outro namespace e a fronteira não for compatível, o fluxo para e exige resolução de conflito antes de continuar.

---

### Fase 2 — Classificar dados

**Entrada:** Project Profile em rascunho; classificação de sensibilidade fornecida por Marley.

**Ação:** definir o Knowledge Namespace do Projeto, atribuir a Data Boundary Policy correspondente à sensibilidade declarada e registrar o destino permitido para o conhecimento extraído.

**Saída:** Knowledge Namespace isolado criado; Data Boundary Policy registrada no Project Profile.

**Caminho de falha — violação de fronteira de dados:** se a Data Boundary Policy entrar em conflito com a classificação de sensibilidade (por exemplo, projeto corporativo com política de namespace pessoal), o fluxo para e aguarda reclassificação explícita por Marley.

---

### Fase 3 — Resolver fontes

**Entrada:** lista canônica de Repositórios; Contexto de execução.

**Ação:** registrar um Repository Resolver para cada Repositório no Contexto atual, mapeando a identidade lógica ao path real sem inscrevê-lo como identidade canônica. Confirmar que cada Repositório está acessível e que a revisão atual pode ser lida.

**Saída:** Repository Resolvers registrados; revisão atual de cada Repositório confirmada e anotada.

**Caminho de falha — resolver ausente:** se um Repositório não tiver resolver configurado para o Contexto atual, registrar como bloqueador. O fluxo não avança para extração enquanto houver Repositório sem resolver.

---

### Fase 4 — Extrair determinístico

**Entrada:** Repository Resolvers resolvidos; revisões confirmadas.

**Ação:** percorrer os Repositórios e extrair fatos estruturalmente inferíveis: stack, módulos, serviços, dependências, endpoints, schemas, eventos, configuração de deploy e cobertura de testes. Cada fato é registrado como Knowledge Record com Repository Reference apontando para revisão e intervalo de código de origem.

**Saída:** conjunto inicial de Knowledge Records no namespace do Projeto; cada registro com revisão e evidência de origem.

**Caminho de falha — extração não suportada:** se um Repositório usar tecnologia cujo parser determinístico não está disponível, os fatos daquele repositório são marcados como `hipótese` e o gap é registrado no relatório de cobertura. O fluxo continua para os demais repositórios.

---

### Fase 5 — Enriquecer semântica

**Entrada:** Knowledge Records extraídos na fase anterior.

**Ação:** descrever responsabilidades, jornadas, relações e decisões arquiteturais que não são inferíveis apenas por sintaxe. Todo enriquecimento que não pode ser apontado a código é marcado explicitamente como `inferido` ou `hipótese`.

**Saída:** Knowledge Records com responsabilidades e relações semânticas documentadas; lacunas identificadas e anotadas.

**Caminho de falha — evidência contraditória:** se duas fontes ou dois registros apresentarem afirmações incompatíveis sobre o mesmo fato (por exemplo, dois schemas para o mesmo contrato), ambos são registrados com flag `contradição` e o gap entra no relatório. Nenhuma das versões é promovida como canônica até resolução.

---

### Fase 6 — Validar evidências

**Entrada:** Knowledge Records com enriquecimento semântico.

**Ação:** amostrar um subconjunto dos registros e verificar cada um contra a fonte declarada: código, migrations, manifests ou sistemas acessíveis no Contexto. Registros validados recebem status `comprovado`; registros que não encontram correspondência recebem status `hipótese`.

**Saída:** relatório de cobertura com percentual comprovado, lista de lacunas e registros marcados como hipótese.

**Caminho de falha — revisão de fonte defasada:** se a revisão anotada no Knowledge Record não corresponder mais à revisão atual do Repositório, o registro recebe status `stale` e entra na lista de lacunas. O fluxo não bloqueia, mas o relatório de cobertura reflete o gap.

---

### Fase 7 — Publicar baseline

**Entrada:** Knowledge Records validados; relatório de cobertura.

**Ação:** persistir todos os Knowledge Records no Knowledge Namespace do Projeto, registrar a revisão exata de cada Repositório como âncora do baseline e produzir o Project Knowledge Graph versionado.

**Saída:** Project Knowledge Graph com baseline versionado; revisão-âncora de cada Repositório registrada.

**Caminho de falha — baseline rejeitado por cobertura insuficiente:** se o percentual de registros comprovados ficar abaixo do limiar mínimo aceitável por Marley, o baseline não é publicado. O fluxo retorna à fase 6 para ampliar a amostra ou à fase 4 para reextrair fontes problemáticas.

---

### Fase 8 — Provar consulta

**Entrada:** Project Knowledge Graph publicado; Knowledge Namespace isolado.

**Ação:** iniciar um agente efêmero com acesso somente ao namespace do Projeto via Context Gateway. Executar perguntas de smoke test cobrindo ao menos: localizar um serviço, recuperar um contrato, rastrear uma dependência e retornar uma Repository Reference resolvível. Registrar cada pergunta, a resposta obtida e a evidência de que a referência aponta para o código correto.

**Saída:** Verification Evidence com as respostas do smoke test e as referências comprovadas.

**Caminho de falha — smoke test do Context Gateway falhou:** se o agente efêmero não conseguir resolver uma Repository Reference ou retornar um Knowledge Record esperado, o baseline não é aprovado. O fluxo retorna à fase 7 para corrigir os registros problemáticos antes de nova tentativa.

---

## Human Gate — Aprovação do baseline

**Posição:** após a fase 8 (Provar consulta) e antes da fase 9 (Ativar incremental).

**O que Marley revisa:**

- Project Profile com fronteiras e Data Boundary Policy.
- Inventário canônico de Repositórios com revisões-âncora.
- Relatório de cobertura: percentual comprovado, lacunas e hipóteses.
- Verification Evidence do smoke test: perguntas, respostas e referências resolvidas.

**Decisões disponíveis:**

| Decisão | Consequência |
|---|---|
| Aprovar | Fluxo avança para a fase 9 |
| Rejeitar com ajuste | Especificar quais registros ou gaps precisam ser corrigidos; fluxo retorna à fase indicada |
| Rejeitar e cancelar | Projeto não é ativado; Knowledge Namespace permanece inativo |

Aprovação de Marley é necessária para avançar, mas não substitui as evidências nem libera blockers pendentes. Consenso entre agentes também não substitui essa aprovação.

---

### Fase 9 — Ativar incremental

**Entrada:** baseline aprovado por Marley; revisão-âncora de cada Repositório.

**Ação:** registrar a revisão-âncora como ponto de partida do monitoramento incremental. A partir deste momento, mudanças nos Repositórios podem acionar atualizações seletivas no Project Knowledge Graph sem repetir o onboarding completo.

**Saída:** Projeto ativo no harness; Knowledge Freshness inicializado com a revisão-âncora de cada Repositório.

**Caminho de falha:** se a revisão-âncora registrada no baseline não corresponder mais ao estado atual de algum Repositório no momento da ativação (por exemplo, commits ocorreram durante a revisão humana), os registros afetados recebem status `stale` imediatamente. O Projeto é ativado mesmo assim, mas o relatório de cobertura inicial reflete os gaps para resolução incremental.

---

## Saídas do fluxo

| Saída | Descrição |
|---|---|
| Project Profile aprovado | Fronteiras, Data Boundary Policy e responsável registrados |
| Knowledge Namespace isolado | Namespace do Projeto criado e protegido por política |
| Inventário canônico de Repositórios | Lista de Repositórios com identidades lógicas e revisões-âncora |
| Project Knowledge Graph versionado | Baseline publicado com todos os Knowledge Records e suas evidências |
| Relatório de cobertura e lacunas | Percentual comprovado, registros marcados como hipótese e gaps identificados |
| Verification Evidence do smoke test | Respostas das perguntas de prova e Repository References resolvidas |

---

## Semântica de falha — resumo

| Falha | Fase | Comportamento |
|---|---|---|
| Resolver ausente | 3 | Bloqueador: fluxo não avança para extração |
| Violação de fronteira de dados | 2 | Bloqueador: aguarda reclassificação por Marley |
| Extração não suportada | 4 | Não bloqueador: gap registrado, fluxo continua |
| Evidência contraditória | 5 | Não bloqueador: ambos os registros marcados com `contradição` |
| Revisão de fonte defasada | 6 | Não bloqueador: registro marcado `stale`, gap no relatório |
| Smoke test do Context Gateway falhou | 8 | Bloqueador: retorna à fase 7 para correção |
| Baseline rejeitado por Marley | Human Gate | Retorna à fase indicada ou cancela o Projeto |
