# Defeitos encontrados

> Classificação: **C** = crítico/bloqueante · **I** = importante · **M** = menor/cosmético
> Origem: **P** = pacote de terceiros · **A** = ambiente/máquina · **M** = projeto Mestre do PC

---

## D1 — BOM UTF-8 quebra o instalador · **C** · origem **A** + **P**

**Sintoma**

```
Error updating Claude configuration: Error: Failed to read config file:
Unexpected token '﻿', "﻿{
    "m"... is not valid JSON
```

**Causa:** `claude_desktop_config.json` começava com BOM (`EF BB BF`). O `setup` usa `JSON.parse` estrito (RFC 8259), que rejeita BOM. Ferramentas Windows — inclusive `Out-File`/`Set-Content` do PowerShell 5.1, que grava UTF-8 **com** BOM por padrão — produzem esse arquivo com BOM com facilidade.

**Prova de que a falha foi segura:** o hash do arquivo depois do erro era exatamente o de antes (`650D9184…AB40`). O `setup` lê, falha no parse e aborta **sem escrever**. Não houve corrupção — diferente do incidente de 2026-11-23, em que instaladores gravaram `\n` literal e corromperam 3 JSONs.

**Mitigação aplicada:** regravação sem BOM via `UTF8Encoding($false)`.

**Sugestão:** sempre validar com parser estrito antes de rodar instaladores de terceiros:

```powershell
node -e "const fs=require('fs'),path=require('path');const p=path.join(process.env.APPDATA,'Claude','claude_desktop_config.json');const t=fs.readFileSync(p,'utf8');if(t.charCodeAt(0)===0xFEFF){console.error('BOM presente -> JSON.parse falha');process.exit(2)}JSON.parse(t);console.log('ok')"
```

`ConvertFrom-Json` **não serve** para esse teste: ele tolera BOM e diria "válido" — foi o que me deu falso positivo na checagem inicial.

`[System.Text.Json.JsonDocument]` também não: essa classe não existe no PowerShell 5.1 (testado — `TypeNotFound`). O caminho confiável nesta máquina é o `node`, que rejeita BOM exatamente como o `JSON.parse` do setup.

---

## D2 — O `setup` não faz backup · **I** · origem **P**

`grep` por `backup`, `.bak` e `copyFile` em `dist/setup-claude-server.js`: **zero ocorrências**. Ele lê o config, altera em memória e sobrescreve com `writeFileSync` (linha ~878). Se o processo morrer no meio da escrita, o arquivo fica truncado sem cópia de segurança.

**Contorno obrigatório:** copiar o config antes. Foi feito (`…bak-dc-20261124-150903`).

---

## D3 — Telemetria ligada por padrão · **I** · origem **P**

Três pontos de envio identificados:

| Momento | Destino |
|---|---|
| `postinstall` → `dist/track-installation.js` | `telemetry.desktopcommander.app/mp/collect` e `dc-telemetry-proxy-83847352264.europe-west1.run.app/mp/collect` |
| Durante o `setup` (`trackEvent`) | mesmo endpoint, com eventos como `npx_setup_update_config` |
| Cada start do servidor | `track-installation.js` também roda |

O `postinstall` foi **bloqueado pelo npm 12** (allowlist `allow-scripts`: apenas `@opencode/cli` e `@xai-official/grok`), então ao menos esse caminho não executou. O `setup` **executou** e enviou eventos.

Nada de conteúdo de arquivo é enviado — são eventos de instalação —, mas é tráfego de rede não solicitado por padrão.

---

## D4 — `@latest` no comando do MCP · **I** · origem **P**

A entrada gravada no config é:

```json
"args": ["/c", "npx", "-y", "@wonderwhy-er/desktop-commander@latest"]
```

Consequências:

1. **Atualização silenciosa a cada boot** do Claude Desktop — código novo de terceiros entra sem revisão.
2. **Dependência de rede no start:** sem internet (ou npm fora), o servidor MCP pode não subir.
3. **Divergência de versão** com a cópia que o Mestre usa (se/quando instalada), gerando comportamento diferente entre clientes.
4. `npx -y` aceita automaticamente qualquer prompt de instalação — nenhuma confirmação humana.

O próprio log do setup já mostrou fragilidade: imprimiu `Desktop Commander MCP vunknown` — `getVersion()` não resolveu a versão.

---

## D5 — O Mestre já tem integração com o pacote, mas o pacote não está instalado · **I** · origem **M**

O projeto possui `v10/chat-integrado/desktop-commander-client.js` (tools `desktop__*` no chat) e o teste `mcp-server/test/desktop-commander-client.test.js`. O cliente exige:

```js
const PACKAGE_DIR  = join(PROJECT_DIR, "node_modules", "@wonderwhy-er", "desktop-commander");
const SERVER_ENTRY = join(PACKAGE_DIR, "dist", "index.js");
```

**Estado real medido hoje:**

```powershell
node -p "require('./node_modules/@wonderwhy-er/desktop-commander/package.json').version"
# Error: Cannot find module …
```

```powershell
grep -n "wonderwhy-er" package.json mcp-server/package.json
# (nenhum resultado)
```

Ou seja: **não está no `node_modules` e não está declarado como dependência**. O caminho de erro do cliente é explícito (`desktop-commander-client.js:57`):

```js
throw new Error("Desktop Commander não está instalado no projeto.");
```

**Efeito prático:** as tools `desktop__*` do chat do Mestre falham até que o pacote seja instalado no projeto — independentemente do que foi feito no Claude Desktop. É uma integração "pela metade".

---

## D6 — `mestre_do_pc` aponta para o clone errado · **M** · origem **M**

O config do Claude Desktop aponta para:

```
C:\Users\Jean\Projetos\ferramentas\Mestre-do-PC-V10
```

Mas o `AGENTS.md` do projeto declara o clone de trabalho como:

```
C:\Users\Jean\Projetos\MeusApps\Mestre-do-PC-V10
```

Existem **3 clones** na máquina (`Projetos\`, `Projetos\ferramentas\`, `Projetos\MeusApps\`). Consequência: o MCP do Claude roda o código de um clone **diferente** do que foi editado neste registro — edições em `MeusApps` não aparecem no Claude até reinstalar o MCP.

---

## D7 — Falha silenciosa no `exit code` · **M** · origem **P**

A primeira execução terminou com **exit 0** apesar do erro fatal:

```
Error updating Claude configuration: Error: Failed to read config file: …
=== exit: 0 ===
```

Quem scriptar `npx … setup` e checar `$LASTEXITCODE` vai concluir "sucesso" com a configuração intocada. É preciso inspecionar o texto, não o código de saída.

---

## D8 — Link de download do pacote do Copilot inacessível · **M** · origem **A**

O pedido anterior (skill `pesquisa-ia-recente`) trouxe um link `api.asm.skype.com`, que respondeu:

| URL | Resposta |
|---|---|
| `/views/original` | 401 (exige autenticação) |
| `/views/original/Baixar%20a%20habilidade…zip` | 404 |

O arquivo existe no blob da conversa, mas não é baixável fora dela. **Nada foi baixado nem executado.** A skill não foi instalada.

---

## D9 — Cache do `npx` corrompido derruba qualquer MCP baseado em `npx` · **C** · origem **A**

**Descoberto em:** 2026-11-24, ao instalar o mesmo pacote no **Claude Code**.

O `claude mcp add desktop-commander -- npx -y @wonderwhy-er/desktop-commander@0.3.4` registrou, mas o status ficou `Failed to connect` (timeout de 30 s na 1ª vez, depois `CONNECTION_CLOSED`). Executando o binário à mão:

```
Error: Cannot find module './toPropertyKey.js'
Require stack:
- ...\npm-cache\_npx\439eac6f098ffe5b\node_modules\@babel\runtime\helpers\defineProperty.js
- ...\node_modules\broker-factory\build\es5\bundle.js
- ...\node_modules\worker-timers\build\es5\bundle.js
- ...\node_modules\mqtt\build\lib\client.js
```

**Estado medido:** `_npx\439eac6f098ffe5b\node_modules\@babel\runtime\helpers\` tem **60 arquivos**; o pacote íntegro traz ~200+. Extração parcial/corrompida do cache.

**Impacto:** qualquer MCP iniciado via `npx` que puxe `@babel/runtime` (direto ou por `mqtt` → `worker-timers`) quebra com `MODULE_NOT_FOUND`. Não é específico do Desktop Commander.

**Contorno aplicado (sem apagar cache):** instalação isolada em `%LOCALAPPDATA%\mcp\desktop-commander` e entrada do MCP apontando para `node <path absoluto>/dist/index.js`. Resultado: `Status: ✔ Connected`.

**Limpeza pendente (exige confirmação do Jean):**

```powershell
Remove-Item "$env:LOCALAPPDATA\npm-cache\_npx\439eac6f098ffe5b" -Recurse -Force
```

---

## D10 — `mestre_do_pc` não conecta no Claude Code · **I** · origem **M**

Medido hoje com `claude mcp list` (Claude Code 2.1.331):

```
mestre_do_pc: C:\Program Files\nodejs\node.exe C:/Users/Jean/Projetos/ferramentas/Mestre-do-PC-V10/mcp-server/index.js
  ✘ Failed to connect — CONNECTION_CLOSED: Connection closed
```

Dois suspeitos, ambos já documentados: (a) clone apontado é o de `Projetos\ferramentas\`, não o canônico (D6); (b) o cliente `mcp` exige `X-Mestre-Mcp-Token` / `MESTRE_LOCAL_MCP_TOKEN`, e a entrada não declara `env` nenhum. Não investigado a fundo nesta sessão — fica registrado.

**Contexto:** no mesmo momento, `plugin:hostinger`, `nvidia-app` e `exa` estavam `✔ Connected` — o problema é da entrada, não do Claude Code.

---

## D11 — `npx skills find` só lista skills, não MCPs · **M** · origem **P**

O CLI sugerido responde `Install with npx skills add <owner/repo@skill>` e lista apenas skills do registry skills.sh (ex.: `mattpocock/skills@git-guardrails-claude-code`, 582,2K installs). Ele **não** descobre pacotes MCP nem plugins de marketplace — para isso as fontes são `claude mcp list`/registro MCP e `claude plugin marketplace list`.

---

## Defeitos descartados na triagem

| Hipótese | Veredito |
|---|---|
| "O setup corrompeu o JSON" | **Não.** Hash idêntico após a falha; abortou antes de escrever |
| "`mestre_do_pc` foi sobrescrita" | **Não.** Valores preservados, verificados byte a byte |
| "npm 12 bloqueou a instalação" | **Não.** O `postinstall` foi bloqueado, mas o `setup` é executado pelo npx e rodou normalmente |
| "`node.exe` do `C:\Program Files` falha nesta máquina" | **Não se confirmou.** `node -v` → v26.12.1 funcionou (a nota antiga da ponte sugeria falha) |
