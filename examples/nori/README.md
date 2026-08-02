# Nori — Piloto de Project Onboarding

Este diretório documenta Nori como o primeiro projeto validado pelo fluxo de **Project Onboarding** do harness. O harness em si é agnóstico a projeto; Nori é apenas o caso concreto que prova o fluxo pela primeira vez.

## Por que Nori foi escolhido como piloto

Nori oferece o conjunto de condições mais favorável para uma primeira validação:

- **Acesso local completo ao código-fonte.** Todos os repositórios estão disponíveis no mesmo ambiente onde o harness roda, sem restrições de rede ou VDI.
- **Kubernetes local.** A plataforma roda com Rancher Desktop, o que permite provar ingestão de serviços reais, health checks e evidências executáveis sem depender de ambiente remoto.
- **Disponibilidade ampla de modelos.** O Contexto Nori não bloqueia nenhum provedor, o que permite testar Model Routing, Escalation Ladder e Budget Envelope com o catálogo completo de LLMs.
- **Agency Profile proativo.** O Contexto autoriza exploração ampla, propostas de melhoria e descoberta de trabalho necessário, cobrindo os cenários mais ricos de fluxo.

Esses fatores combinados fazem de Nori o ambiente onde falhas de fluxo aparecem mais cedo e são mais fáceis de corrigir.

## Contexto conceitual

O harness distingue **Projeto** de **Repositório** de **Workspace**. Nori é um Projeto com múltiplos repositórios. Cada repositório possui identidade lógica estável expressa como `repo://<nome-logico>@<revisao>/caminho#L-L`. Caminhos absolutos da máquina não fazem parte dessa identidade: eles existem operacionalmente no Repository Resolver de cada Contexto, mas não são registrados como referências canônicas.

O conhecimento sobre Nori vive no seu próprio **Knowledge Namespace** dentro da Context Layer. Nenhum dado cruza automaticamente para outros namespaces. A **Data Boundary Policy** impede que conhecimento corporativo suba para o namespace pessoal sem Knowledge Promotion explícita.

## O que o Project Onboarding prova

O fluxo de onboarding não é um script de configuração. É a prova de que o harness consegue, de forma reproduzível:

1. **Inventário de repositórios.** Descobrir os repositórios do projeto, registrar suas identidades lógicas e mapear o Repository Resolver para o Contexto local.
2. **Baseline do Project Knowledge Graph.** Executar o Initial Knowledge Load, extrair fatos determinísticos, enriquecer relações semânticas e publicar um grafo baseline versionado.
3. **Revisão de freshness.** Registrar em qual revisão cada descoberta foi observada e sinalizar corretamente o estado `stale` quando o código avança.
4. **Amostragem de evidências.** Validar amostras do grafo contra as fontes reais, comprovando que Repository References resolvem para o código correto no Contexto local.
5. **Prova de recuperação pelo Context Gateway.** Demonstrar que agentes conseguem consultar o conhecimento publicado via `kb://` e `repo://`, receber um Context Pack mínimo e executar uma tarefa real com base nele, sem injetar o grafo inteiro no prompt.

Quando esses cinco resultados tiverem Verification Evidence anexada, o Projeto Nori passa a usar atualizações incrementais e o fluxo de onboarding está validado para os próximos projetos.

## O que este diretório não contém

Configuração de ambiente, segredos, credenciais, valores de variáveis de ambiente, caminhos absolutos de máquina, código-fonte copiado, URLs de repositórios remotos ou TODOs de implementação. Esses artefatos pertencem ao repositório ou ao Workspace, não à documentação conceitual do piloto.
