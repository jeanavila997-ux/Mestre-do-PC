# O que foi apagado

> Resposta curta: **nada de valor**. Nenhum arquivo do repositório, nenhuma configuração, nenhum log.

---

## Nada foi removido do sistema

| Categoria | Resultado |
|---|---|
| Arquivos do repositório do Mestre | 0 apagados |
| Configurações de MCP | 0 removidas (`mestre_do_pc` preservada) |
| Logs do Mestre (`logs/`) | 0 apagados |
| `.env`, tokens, chaves | 0 tocados — nenhum segredo lido nesta sessão |
| Entradas de MCP em outros clientes (OpenCode, Codex, Cline, Grok) | 0 tocadas |

---

## O que o `setup` apaga por conta própria

Auditado no código antes de executar (`dist/setup-claude-server.js`, ~linha 867):

```js
// Check if the old "desktopCommander" exists and remove it
if (config.mcpServers.desktopCommander) {
    delete config.mcpServers.desktopCommander;
}
```

Ele remove **somente** a chave legada `desktopCommander` (nome antigo do próprio pacote, sem hífen) para substituí-la por `desktop-commander`.

**Nesta máquina essa chave não existia** — a única entrada era `mestre_do_pc`, que não casa com `desktopCommander`. Portanto: nenhuma remoção efetiva.

---

## Descarte de temporários (higiene, não é perda)

Estes podem ser apagados a qualquer momento; não fazem parte do sistema:

```
%TEMP%\opencode\dc-inspect\          (tgz + árvore extraída, ~6 MB)
```

```powershell
Remove-Item "$env:TEMP\opencode\dc-inspect" -Recurse -Force
```

Não foram apagados nesta sessão — ficam como prova da inspeção.

---

## Sobre a remoção do BOM

O único "apagamento" real foi **3 bytes** (`EF BB BF`) no início de `claude_desktop_config.json`. Isso não é perda de dado: o BOM não pertence a JSON (RFC 8259 não o permite) e era justamente a causa da falha. O conteúdo semântico do arquivo ficou idêntico.

---

## Reversão completa da sessão

Para voltar ao estado de 15:09 de 2026-11-24:

```powershell
# 1. restaura o config (volta COM BOM e SEM desktop-commander)
Copy-Item "$env:APPDATA\Claude\claude_desktop_config.json.bak-dc-20261124-150903" `
          "$env:APPDATA\Claude\claude_desktop_config.json" -Force

# 2. remove o cache do npx (opcional)
Remove-Item "$env:LOCALAPPDATA\npm-cache\_npx" -Recurse -Force -ErrorAction SilentlyContinue

# 3. reinicia o Claude Desktop
```

O próprio pacote tem um desinstalador, mas ele mexe no config sem tratar BOM — preferir o backup acima.

```powershell
npx -y @wonderwhy-er/desktop-commander@0.3.4 remove   # alternativa oficial
```
