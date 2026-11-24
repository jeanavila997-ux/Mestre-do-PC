# Melhorias propostas

> Ordenadas por relação custo/benefício. Nenhuma foi aplicada — são propostas.

---

## M1 — Fixar a versão do MCP em vez de `@latest` · esforço **baixo** · ganho **alto**

**Hoje**

```json
"args": ["/c", "npx", "-y", "@wonderwhy-er/desktop-commander@latest"]
```

**Proposta**

```json
"args": ["/c", "npx", "-y", "@wonderwhy-er/desktop-commander@0.3.4"]
```

**Por quê:** elimina atualização silenciosa, dispensa rede no boot e iguala a versão entre clientes. Atualizar passa a ser um ato deliberado (`@0.3.5` quando houver motivo).

**Detalhe:** manter um campo de comentário não é possível em JSON padrão — registrar a versão neste documento e no `InfoMaquina/03-manutencao/registro-manutencao.md`.

---

## M2 — Instalar o pacote dentro do projeto (corrige D5) · esforço **médio** · ganho **alto**

O Mestre já tem o cliente pronto; falta a dependência. Duas opções:

| Opção | Comando | Trade-off |
|---|---|---|
| A — dependência declarada | `npm install @wonderwhy-er/desktop-commander@0.3.4` na raiz | entra no `package.json` + lockfile; `npm ci` passa a exigir; CI precisa aceitar |
| B — instalação não rastreada | instalar e adicionar ao `.gitignore` | não mexe no lockfile; instalação não reproduzível |

**Recomendação: A**, com versão exata. O cliente `desktop-commander-client.js` já resolve exatamente `node_modules/@wonderwhy-er/desktop-commander/dist/index.js` — nenhuma alteração de código é necessária.

**Cuidado obrigatório:** o `postinstall` do pacote roda `track-installation.js` (telemetria). O `AGENTS.md` já documenta que npm 12 bloqueia scripts nesta máquina — verificar se o comportamento desejado é bloquear (preferível) ou permitir.

**Critério de aceite:** a tool `desktop__get_config` deixa de responder `"Desktop Commander não está instalado no projeto."` e `mcp-server/test/desktop-commander-client.test.js` passa sem o aviso de pacote ausente.

---

## M3 — Guarda de BOM nos instaladores e no próprio Mestre · esforço **baixo** · ganho **médio**

Adicionar um utilitário que sempre grava JSON sem BOM (e valida com parser estrito) antes de qualquer escrita em config de MCP:

```js
// padrao a adotar em scripts que escrevem config de cliente MCP
const text = await readFile(p, "utf8");
const clean = text.replace(/^\uFEFF/, "");
JSON.parse(clean);                       // valida estrito
await writeFile(p, clean, "utf8");       // sem BOM
```

Onde aplicar: `install.ps1`, `scripts/*.ps1` que gravem `claude_desktop_config.json` / `.claude.json`, e os scripts de sincronização de MCP.

**Contexto:** é a **segunda** vez que JSON de cliente MCP causa problema nesta máquina (2026-11-23: `\n` literal; hoje: BOM). Vale virar regra no `AGENTS.md`.

---

## M4 — Unificar o clone de referência nos configs de MCP · esforço **baixo** · ganho **médio**

`mestre_do_pc` aponta para `Projetos\ferramentas\Mestre-do-PC-V10`, mas o clone de trabalho declarado no `AGENTS.md` é `Projetos\MeusApps\Mestre-do-PC-V10`. Decidir qual é o canônico e apontar **todos** os clientes para ele:

| Cliente | Onde |
|---|---|
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | `~/.claude.json` |
| Cline | `~/.cline/data/settings/mcp_settings.json` |
| OpenCode | `~/.config/opencode/opencode.json` |
| Codex | `~/.codex/config.toml` |

**Efeito colateral positivo:** resolve parte das duplicidades já mapeadas em `ponte-claude-grok/para-opencode.md` (2026-11-23 00:41).

---

## M5 — Desligar a telemetria do Desktop Commander · esforço **baixo** · ganho **baixo/médio**

O pacote grava config própria em `~/.claude-server-commander/`. Se houver opção de opt-out documentada, aplicá-la; caso contrário, ao menos manter o `postinstall` bloqueado (estado atual, via `allowScripts` do npm 12) e restringir a saída por firewall/hosts se o incômodo incomodar.

**Não fazer:** bloquear por `hosts` sem testar — pode derrubar o servidor se ele tratar erro de rede como fatal no start.

---

## M6 — Botão de permissão para execução de comandos no chat · esforço **alto** · ganho **alto**

Pedido original do Jean, ainda não implementado. O desenho recomendado:

- **Não** criar caminho paralelo à whitelist. O botão deve operar **dentro** do modelo existente.
- Fluxo proposto: o agente gera um script que **não** casa com nenhuma entrada de `v10/allowed-operations.json` → o chat mostra um cartão com **prévia do comando completo**, `destructive: true|false`, caminho do arquivo e usuário → botão "Permitir uma vez" / "Permitir nesta sessão" / "Negar".
- **Aprovação vinculada a hash do conteúdo**, não ao nome do script: se o arquivo mudar depois do clique, a permissão cai.
- Escopo mínimo: um comando, TTL curto (ex.: 10 min), nunca `-NoProfile` herdando sessão elevada.
- Auditoria em `logs/audit/` com o hash aprovado, o cliente (`v10-web`) e o timestamp.
- Estado da aprovação em memória do launcher — nunca em `localStorage` (ver `security-and-hardening`: nada de decisão de autorização em storage acessível ao cliente).

**Risco a evitar:** transformar o botão em "desligar a whitelist". Se for para executar qualquer coisa, o valor do Mestre (fail-closed) desaparece.

---

## M7 — Registrar a skill `pesquisa-ia-recente` quando houver o pacote real · esforço **médio** · ganho **médio**

O link do Copilot não é baixável (D8). Alternativas: pedir o arquivo local, ou eu recriar a skill a partir da estrutura descrita (7 arquivos: `SKILL.md`, 2 `references/`, 1 `assets/`, 1 `examples/`, 1 `scripts/`, `README` + `LICENSE`).

**Atenção de infraestrutura:** o parser de skills do projeto e o do JARVIS **não aceitam `description` multilinha** em YAML — usar uma linha só (já houve normalização por isso na cópia do JARVIS, em 2026-11-22 17:03).

---

## Resumo priorizado

| # | Melhoria | Esforço | Ganho | Quando |
|---|---|---|---|---|
| M1 | Fixar `@0.3.4` | baixo | alto | imediato |
| M2 | Instalar no projeto (D5) | médio | alto | próximo ciclo |
| M3 | Guarda de BOM + regra no AGENTS.md | baixo | médio | próximo ciclo |
| M4 | Unificar clone nos MCPs | baixo | médio | próximo ciclo |
| M6 | Botão de permissão | alto | alto | planejar antes |
| M5 | Telemetria | baixo | baixo | quando incomodar |
| M7 | Skill `pesquisa-ia-recente` | médio | médio | aguarda pacote |
