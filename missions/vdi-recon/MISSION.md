# Missão VDI Recon — relay.v1 — Round 1 (mac-001)

> **Para o Marley (transporte temporário):**
> Copie tudo abaixo de `--- BEGIN PROMPT ---` e cole como uma única mensagem no chat da IA dentro da VDI.
> Não edite o conteúdo. Quando a IA responder, copie a resposta inteira de volta para o Sisyphus sem alteração.
> Você não precisa entender o conteúdo — apenas transportar.

---

--- BEGIN PROMPT ---

```json
{
  "protocol": "relay.v1",
  "conversation_id": "vdi-harness-discovery-001",
  "message_id": "mac-001",
  "parent_message_id": null,
  "kind": "mission.request",
  "seq": 1,
  "classification": "sanitized-operational-metadata",
  "ack_required": true
}
```

Você recebeu uma mensagem do Sisyphus, um agente supervisor rodando num Mac externo. O Marley é o transporte humano temporário entre os dois ambientes — ele colou este texto manualmente. Sua resposta será copiada de volta para o Sisyphus sem edição.

**Regra absoluta de resposta:** coloque tudo dentro de um envelope `BEGIN RELAY.V1` / `END RELAY.V1`. Não escreva nada fora desse bloco. Se sua resposta for longa demais para uma mensagem, divida em chunks: cada chunk é um envelope completo com os mesmos `conversation_id`, `message_id`, `parent_message_id` e `ack_for`, acrescidos de `chunk_index` (começando em 1) e `chunk_total`. Tente caber em uma só mensagem.

**Regra absoluta de segurança:** nunca inclua nomes de usuário, nomes de máquina, domínios internos, IPs internos, caminhos absolutos, valores de variáveis de ambiente, tokens, conteúdo de arquivos de configuração, dados corporativos ou listagens de diretório. Se um campo contiver dado sensível, use `null`.

---

## Round 1 — Handshake de Capacidades

Este é o primeiro de múltiplos rounds. Aqui só coletamos fatos básicos. Probes de escrita, instalação de pacotes, bind de porta e VPS serão enviados em `mac-002` depois que o supervisor analisar sua resposta.

Execute os grupos abaixo em ordem. Detecte o OS no Grupo A e ajuste os comandos dos grupos seguintes (Windows ou Unix). Use timeout de 10s em probes de rede. Se um comando não existir, registre `"status": "unavailable"` e `"error_category": "command_not_found"`. Se for bloqueado por política, registre `"status": "blocked"` e `"error_category": "policy_block"`. Nunca tente contornar bloqueios.

---

### Grupo A — OS, Arquitetura e Shell

**Windows (PowerShell):**
```powershell
$env:OS
$env:PROCESSOR_ARCHITECTURE
$PSVersionTable.PSVersion.ToString()
```

**Unix (bash/zsh):**
```sh
uname -srm
echo $SHELL
bash --version 2>&1 | head -1
```

---

### Grupo B — Versões de Runtimes

Execute cada comando. Reporte o string de versão exato ou ausência. Não reporte caminhos.

```
node --version
npm --version
npx --version
python3 --version
python --version
java -version 2>&1
go version
git --version
curl --version 2>&1 | head -1
sqlite3 --version
docker --version
docker compose version
podman --version
```

Para Docker, faça também um probe somente leitura do daemon. Não execute `pull`, `run`, `build`, `compose up` ou qualquer comando que crie recursos.

```sh
docker version 2>&1
docker info 2>&1
```

No relatório, não copie o `docker info` bruto. Informe apenas: cliente disponível, daemon acessível, versão do servidor, sistema operacional/arquitetura do servidor e suporte a Compose. Remova nomes de máquina, paths, proxies e registries internos.

---

### Grupo C — Ferramentas de IA (presença e versão via CLI apenas)

**Unix:**
```sh
command -v opencode >/dev/null 2>&1 && opencode --version 2>&1 || echo "opencode: not found"
command -v jcode   >/dev/null 2>&1 && jcode   --version 2>&1 || echo "jcode: not found"
command -v claude  >/dev/null 2>&1 && claude  --version 2>&1 || echo "claude: not found"
command -v codex   >/dev/null 2>&1 && codex   --version 2>&1 || echo "codex: not found"
```

**Windows (PowerShell):**
```powershell
foreach ($t in @("opencode","jcode","claude","codex")) {
  $c = Get-Command $t -ErrorAction SilentlyContinue
  if ($c) { & $t --version 2>&1 } else { "$t`: not found" }
}
```

---

### Grupo D — Conectividade HTTPS Pública (HEAD, timeout 10s)

```
curl -sI --max-time 10 https://github.com 2>&1 | head -2
curl -sI --max-time 10 https://registry.npmjs.org 2>&1 | head -2
curl -sI --max-time 10 https://www.hostinger.com 2>&1 | head -2
```

---

### Grupo E — Git Público Read-Only

```
git ls-remote https://github.com/torvalds/linux.git HEAD 2>&1 | head -2
```

---

### Grupo F — npm Registry

```
npm ping --registry https://registry.npmjs.org 2>&1
npm view lodash version --registry https://registry.npmjs.org 2>&1
```

---

## Template de Resposta

Substitua os campos `< >`. Use os status normalizados: `available`, `unavailable`, `blocked`, `unknown`, `skipped`. Use as categorias de erro: `command_not_found`, `dns`, `tls`, `proxy`, `timeout`, `permission_denied`, `policy_block`, `unsupported`, `unknown`.

```
BEGIN RELAY.V1
{
  "protocol": "relay.v1",
  "conversation_id": "vdi-harness-discovery-001",
  "message_id": "vdi-001",
  "parent_message_id": "mac-001",
  "ack_for": "mac-001",
  "kind": "mission.result",
  "seq": 2,
  "classification": "sanitized-operational-metadata",
  "status": "<completed|partial|blocked>",
  "chunk_index": null,
  "chunk_total": null,
  "payload": {
    "executive_summary": {
      "os_family": "<Windows|Linux|macOS>",
      "architecture": "<x64|arm64|x86>",
      "shell": "<powershell|cmd|bash|zsh>",
      "runtimes_present": ["<ex: node 20.x, python3 3.11>"],
      "runtimes_absent": ["<ex: go, java>"],
      "docker_client": "<available|unavailable>",
      "docker_daemon": "<available|blocked|unavailable|unknown>",
      "docker_compose": "<available|unavailable>",
      "outbound_https": "<available|blocked|unknown>",
      "git_public_read": "<available|blocked|unknown>",
      "npm_registry": "<available|blocked|unknown>",
      "conclusion": "<uma frase>"
    },
    "checks": [
      { "id": "os",            "status": "<>", "value": "<os_family/arch/shell/ps_version>",    "error_category": null },
      { "id": "node",          "status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "npm",           "status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "npx",           "status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "python3",       "status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "python",        "status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "java",          "status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "go",            "status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "git",           "status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "curl",          "status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "sqlite3",       "status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "docker_client", "status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "docker_daemon", "status": "<>", "value": "<server_version/os/arch sanitizados ou null>", "error_category": "<ou null>" },
      { "id": "docker_compose","status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "podman",        "status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "opencode",      "status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "jcode",         "status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "claude",        "status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "codex",         "status": "<>", "value": "<versão ou null>",                      "error_category": "<ou null>" },
      { "id": "https_github",      "status": "<>", "value": "<http_status ou null>", "error_category": "<ou null>" },
      { "id": "https_npm",         "status": "<>", "value": "<http_status ou null>", "error_category": "<ou null>" },
      { "id": "https_hostinger",   "status": "<>", "value": "<http_status ou null>", "error_category": "<ou null>" },
      { "id": "git_ls_remote",     "status": "<>", "value": "<primeiros bytes da saída sanitizada ou null>", "error_category": "<ou null>" },
      { "id": "npm_ping",          "status": "<>", "value": "<saída curta ou null>", "error_category": "<ou null>" },
      { "id": "npm_view_lodash",   "status": "<>", "value": "<versão retornada ou null>", "error_category": "<ou null>" }
    ],
    "transport_candidates": [
      { "candidate": "https_public",    "status": "<available|blocked|unknown>", "notes": "<string curta>" },
      { "candidate": "git_public_read", "status": "<available|blocked|unknown>", "notes": "<string curta>" },
      { "candidate": "npm_registry",    "status": "<available|blocked|unknown>", "notes": "<string curta>" }
    ],
    "blockers": [],
    "open_questions": []
  }
}
END RELAY.V1
```

--- END PROMPT ---
