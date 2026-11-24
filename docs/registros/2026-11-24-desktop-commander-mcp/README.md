# Registro — instalação do MCP Desktop Commander

> **Data:** 2026-11-24, a partir de 15:09 (horário local)
> **Ambiente:** `C:\Users\Jean\Projetos\MeusApps\Mestre-do-PC-V10` (branch `feat/extensao-ferramentas-20261121`, HEAD `cc211d3`)
> **Máquina:** Windows 11, Node v26.12.1, npm 12.2.3
> **Tipo:** operação de instalação em cliente MCP externo (fora do repositório)
> **Status:** concluída e validada

---

## Resumo em uma frase

Instalamos o MCP `@wonderwhy-er/desktop-commander@0.3.4` no **Claude Desktop**; a primeira tentativa falhou por causa de um **BOM UTF-8** no arquivo de configuração, o arquivo foi regravado sem BOM e a segunda tentativa passou. **Nenhum arquivo do repositório do Mestre foi alterado.**

---

## Índice dos documentos

| Arquivo | Conteúdo |
|---|---|
| [`01-mudancas.md`](01-mudancas.md) | O que mudou, com valores antes/depois e hashes |
| [`02-remocoes.md`](02-remocoes.md) | O que foi apagado (e o que deliberadamente **não** foi) |
| [`03-defeitos.md`](03-defeitos.md) | Defeitos encontrados — do pacote, do ambiente e do próprio Mestre |
| [`04-melhorias.md`](04-melhorias.md) | Melhorias propostas, com custo e risco |
| [`05-plano.md`](05-plano.md) | Plano de ação em etapas, com critério de aceite |

---

## Linha do tempo

| Hora | Evento |
|---|---|
| 15:09:03 | Backup do config do Claude: `claude_desktop_config.json.bak-dc-20261124-150903`; hash registrado `650D9184…AB40` |
| 15:09 | Inspeção do pacote antes de executar (`npm pack` em `%TEMP%\opencode\dc-inspect`, 4,9 MB extraídos) |
| ~15:10 | 1ª execução de `npx … setup`: **falhou** com `Failed to read config file: Unexpected token '﻿'` |
| ~15:12 | Verificação pós-falha: hash idêntico ao backup → **nada foi escrito** |
| ~15:14 | Regravação do config sem BOM; bytes iniciais `EF BB BF 7B` → `7B 0D 0A` |
| ~15:15 | 2ª execução: `✅ Installation successfully completed` |
| ~15:16 | Validação: `mcpServers` = `mestre_do_pc`, `desktop-commander` |

---

## Comando executado

```powershell
npx -y @wonderwhy-er/desktop-commander@latest setup
```

Efeito: o binário `setup` (`dist/setup-claude-server.js`) acrescenta a entrada abaixo em `%APPDATA%\Claude\claude_desktop_config.json`:

```json
"desktop-commander": {
  "command": "cmd",
  "args": ["/c", "npx", "-y", "@wonderwhy-er/desktop-commander@latest"]
}
```

---

## Evidências

- **Config final:** `C:\Users\Jean\AppData\Roaming\Claude\claude_desktop_config.json` — `mcpServers: mestre_do_pc, desktop-commander`
- **Entrada do Mestre preservada** (não foi tocada):
  ```json
  "mestre_do_pc": {
    "command": "node",
    "args": ["C:\\Users\\Jean\\Projetos\\ferramentas\\Mestre-do-PC-V10\\mcp-server\\index.js"],
    "env": { "MESTRE_PROJETO_PATH": "C:\\Users\\Jean\\Projetos\\ferramentas\\Mestre-do-PC-V10" }
  }
  ```
- **Backup:** `claude_desktop_config.json.bak-dc-20261124-150903` (o setup **não** cria backup próprio — verificado no código antes de rodar)
- **Pacote inspecionado:** `@wonderwhy-er/desktop-commander@0.3.4` (dist-tag `latest`; existe também `alpha` 0.3.4-alpha.0)
- **Git do Mestre:** inalterado por esta operação — 39 entradas no `git status` já existiam antes (34 `??`, 3 `D`, 2 `M`)

---

## Escopo deste registro

Este documento cobre **apenas** a instalação do MCP no Claude Desktop. Dois pedidos da mesma sessão ficaram fora e estão anotados no plano (`05-plano.md`):

1. a skill `pesquisa-ia-recente` (pacote do Copilot não pôde ser baixado — o link exige sessão autenticada);
2. o botão de permissão para executar comandos no chat quando o agente cria scripts fora da biblioteca.

---

**Não versionado.** Conforme instrução, esta pasta foi criada localmente e **não** foi commitada nem enviada a nenhum remoto.
