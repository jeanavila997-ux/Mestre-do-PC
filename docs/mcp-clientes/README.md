# MCP do Mestre em outros clientes

O instalador configura o MCP local `mestre-do-pc` em OpenCode, Claude Code, Claude Desktop, Cline, Codex e Grok. Ele usa transporte `stdio`: o processo MCP lê o token local internamente e o envia ao launcher, sem gravar o segredo nos arquivos dos clientes.

## Requisitos

- Windows com PowerShell 5.1 ou superior.
- Node.js `>= 22.13.0`.
- O launcher do Mestre ativo em `http://127.0.0.1:7777`.
- A árvore do projeto contendo `mcp-server/index.js` e `v10/launcher.js`.

## Uso

Simule primeiro, sem alterar arquivos:

```powershell
pwsh ./scripts/instalar-mcp-clientes.ps1 -WhatIf
```

Instale em todos os clientes suportados:

```powershell
pwsh ./scripts/instalar-mcp-clientes.ps1
```

Selecione clientes:

```powershell
pwsh ./scripts/instalar-mcp-clientes.ps1 -Client OpenCode,ClaudeCode,Cline
```

Use outra raiz do projeto ou outro diretório de configurações:

```powershell
pwsh ./scripts/instalar-mcp-clientes.ps1 `
  -ProjectRoot "C:\caminho\Mestre-do-PC" `
  -NodePath "C:\caminho\node.exe" `
  -ConfigRoot "$env:USERPROFILE"
```

## Parâmetros

| Parâmetro | Padrão | Função |
|---|---|---|
| `-ProjectRoot` | raiz do repositório | Pasta que contém o MCP e o launcher |
| `-NodePath` | `node` encontrado no `PATH` | Executável Node usado pelo cliente |
| `-ConfigRoot` | `%USERPROFILE%` | Base das configurações dos clientes |
| `-Client` | `All` | `All`, `OpenCode`, `ClaudeCode`, `ClaudeDesktop`, `Cline`, `Codex` ou `Grok` |
| `-WhatIf` | desativado | Mostra as alterações sem escrever |

## Backups e preservação

Antes de modificar cada arquivo existente, o instalador cria um backup com o sufixo `.bak-mcp-installer-*`. As demais configurações são preservadas. Arquivos JSON inválidos interrompem a execução antes da escrita.

## Exemplos

- `mcp-stdio.example.json`: formato genérico para clientes que executam o MCP localmente. Substitua `<MESTRE_PROJETO_PATH>` pela raiz real do projeto.
- `mcp-http.example.json`: alternativa para clientes HTTP. Substitua `${MESTRE_LOCAL_MCP_TOKEN}` pela sintaxe de expansão de ambiente do cliente ou injete o valor por um mecanismo seguro.

Não cole o token em arquivos compartilhados, versionados ou logs. O endpoint continua em loopback e não requer OAuth.

## JARVIS

O JARVIS possui integração própria via `MESTRE_MCP` e não é alterado por este instalador.
