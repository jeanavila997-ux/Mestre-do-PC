# O que mudou

> Tudo o que foi alterado nesta sessão, com antes/depois verificável.

---

## 1. Configuração do Claude Desktop (a única mudança permanente)

**Arquivo:** `C:\Users\Jean\AppData\Roaming\Claude\claude_desktop_config.json`

### Antes

```json
{
    "mcpServers": {
        "mestre_do_pc": {
            "command": "node",
            "args": ["C:\\Users\\Jean\\Projetos\\ferramentas\\Mestre-do-PC-V10\\mcp-server\\index.js"],
            "env": { "MESTRE_PROJETO_PATH": "C:\\Users\\Jean\\Projetos\\ferramentas\\Mestre-do-PC-V10" }
        }
    }
}
```

- Tamanho: 706 bytes
- Última modificação antes da sessão: 14/11/2026 06:11:45
- Hash SHA-256: `650D9184FD39FD57B93BE16EE05B9C23E5E08C2355D4B2ECCFFF8F5D12EEAB40`
- **Começava com BOM UTF-8** (`EF BB BF 7B`)

### Depois

- `mcpServers` passa a ter **duas** entradas: `mestre_do_pc` (intacta) e `desktop-commander` (nova)
- **BOM removido**: bytes iniciais agora `7B 0D 0A` (`{` + CRLF)

```json
"desktop-commander": {
  "command": "cmd",
  "args": ["/c", "npx", "-y", "@wonderwhy-er/desktop-commander@latest"]
}
```

### Duas mudanças em uma

| # | Mudança | Quem causou |
|---|---|---|
| 1 | Inclusão da entrada `desktop-commander` | `setup` do pacote |
| 2 | Remoção do BOM do arquivo | correção manual necessária para o passo 1 funcionar |

O passo 2 não é cosmético: **sem ele, qualquer ferramenta que use `JSON.parse` estrito recusa o arquivo** — foi exatamente o que derrubou a primeira execução.

---

## 2. Arquivo de backup criado

**Caminho:** `C:\Users\Jean\AppData\Roaming\Claude\claude_desktop_config.json.bak-dc-20261124-150903`

Cópia fiel do estado anterior (com BOM e sem `desktop-commander`). Serve para reverter:

```powershell
Copy-Item "$env:APPDATA\Claude\claude_desktop_config.json.bak-dc-20261124-150903" `
          "$env:APPDATA\Claude\claude_desktop_config.json" -Force
```

> Atenção: restaurar o backup **traz o BOM de volta**.

---

## 3. Diretório de estado do pacote

**Caminho:** `C:\Users\Jean\.claude-server-commander`

Já existia antes da sessão (criado por uso anterior do pacote). O `setup` grava log e configuração próprios ali; nesta sessão não foi inspecionado o conteúdo (pode conter histórico de execução).

---

## 4. Artefatos temporários (fora do repositório)

| Caminho | Tamanho | Natureza |
|---|---|---|
| `%TEMP%\opencode\dc-inspect\wonderwhy-er-desktop-commander-0.3.4.tgz` | ~1,3 MB | pacote baixado para inspeção |
| `%TEMP%\opencode\dc-inspect\package\` | 4,9 MB | pacote extraído (código-fonte lido) |

Criados **de propósito** para auditar o instalador antes de executá-lo. Descartáveis.

---

## 5. O que NÃO mudou

Verificado, não presumido:

- **Repositório do Mestre:** nenhum arquivo alterado por esta operação. O `git status` continua com as 39 entradas que já existiam (34 `??`, 3 `D`, 2 `M`) — todas anteriores a esta sessão.
- **`package.json` do Mestre e do `mcp-server/`:** não declaram `@wonderwhy-er/desktop-commander` (confirmado por `grep`). Nada foi adicionado.
- **`node_modules`:** o pacote **não** está instalado no projeto (ver `03-defeitos.md`, item D5).
- **`v10/allowed-operations.json`:** não tocado (a regra do `AGENTS.md` proíbe sem confirmação explícita).
- **Configuração do MCP do Mestre:** `mestre_do_pc` seguiu com os mesmos valores, byte a byte.
- **Nenhum commit, nenhum push.**
