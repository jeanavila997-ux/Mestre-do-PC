# Plano de ação

> Etapas independentes, em ordem de risco crescente. Nenhuma foi executada — este arquivo é o roteiro.

---

## Etapa 0 — Validar o estado atual (5 min, risco zero)

Feito nesta sessão, repetir antes de reabrir o assunto:

```powershell
# JSON estrito (rejeita BOM de propósito) — usa node, que falha no BOM como o setup falhou
node -e "const fs=require('fs'),path=require('path');const p=path.join(process.env.APPDATA,'Claude','claude_desktop_config.json');const t=fs.readFileSync(p,'utf8');if(t.charCodeAt(0)===0xFEFF){console.error('BOM presente -> JSON.parse falha');process.exit(2)}const j=JSON.parse(t);console.log('servers:',Object.keys(j.mcpServers).join(', '))"
```

**Critério de aceite:** imprime `servers: mestre_do_pc, desktop-commander` e sai com código 0.

> Já executado nesta sessão: `servers: mestre_do_pc, desktop-commander`, exit 0.
>
> **Não** use `ConvertFrom-Json` (toleraria o BOM e daria falso positivo) nem `[System.Text.Json.JsonDocument]` (essa classe não existe no PowerShell 5.1 — testado e falhou).

**Pendência imediata:** reiniciar o Claude Desktop — o setup avisou `Windows: Claude restart skipped - requires manual restart`. Sem reiniciar, o servidor não aparece.

---

## Etapa 1 — Fixar a versão (2 min, risco baixo)

```powershell
$p = Join-Path $env:APPDATA "Claude\claude_desktop_config.json"
Copy-Item $p "$p.bak-pin-$(Get-Date -Format yyyyMMdd-HHmmss)"
$j = Get-Content $p -Raw | ConvertFrom-Json
$j.mcpServers."desktop-commander".args = @("/c","npx","-y","@wonderwhy-er/desktop-commander@0.3.4")
# grava SEM BOM, senão recria o defeito D1
[System.IO.File]::WriteAllText($p, ($j | ConvertTo-Json -Depth 10),
  (New-Object System.Text.UTF8Encoding($false)))
```

**Critério de aceite:** Etapa 0 continua passando e o `args` mostra `@0.3.4`.

**Rollback:** restaurar o `.bak-pin-*`.

---

## Etapa 2 — Decidir sobre o D5 (integração do Mestre)

O chat do Mestre tem tools `desktop__*` que hoje falham por falta do pacote. Três caminhos:

| Caminho | Ação | Consequência |
|---|---|---|
| **A** | `npm install @wonderwhy-er/desktop-commander@0.3.4` na raiz e commitar `package.json` + lockfile | integração funciona; CI e `npm ci` passam a depender do pacote |
| **B** | Remover `desktop-commander-client.js` e o teste, e limpar as rotas `desktop__*` do chat | menos superfície; perde o recurso |
| **C** | Deixar como está e documentar como "feature desligada" | zero código; mantém a dívida |

**Recomendação: A.** O código já está pronto; falta só a dependência.

Se A: **pare o launcher antes dos testes** (`:7777`), como manda o `AGENTS.md`, e valide:

```powershell
cd C:\Users\Jean\Projetos\MeusApps\Mestre-do-PC-V10\mcp-server
npm test -- --test-name-pattern="desktop"
```

**Critério de aceite:** `desktop__get_config` responde `provider: desktop-commander` em vez do erro de pacote ausente.

---

## Etapa 3 — Higiene de JSON de cliente MCP (regra + código)

1. Acrescentar em `AGENTS.md`, na seção de regras duras: *"JSON de config de cliente MCP grava-se sem BOM e valida-se com parser estrito; `ConvertFrom-Json` não serve como validação."*
2. Criar `scripts/json-config.ps1` (ou `.mjs`) com `Read-McpJson` / `Write-McpJson` sem BOM.
3. Aplicar nos scripts que hoje gravam config de MCP.

**Critério de aceite:** existe um único ponto de escrita de JSON de config, e ele remove BOM na leitura e não escreve BOM.

---

## Etapa 4 — Unificar o clone de referência (D6)

1. Decidir o canônico: `MeusApps\Mestre-do-PC-V10` (é o que o `AGENTS.md` manda).
2. Atualizar `MESTRE_PROJETO_PATH` e `args` em todos os clientes listados em M4.
3. Arquivar os clones redundantes **somente com confirmação explícita** do Jean — apagar/mover exige aprovação.

**Critério de aceite:** todos os clientes apontam para o mesmo caminho; `Invoke-RestMethod http://127.0.0.1:7777/ping` responde do clone canônico.

---

## Etapa 5 — Botão de permissão (M6) — planejar antes de codar

Ordem obrigatória, seguindo o fluxo de skills do projeto:

1. **Spec** em `docs/superpowers/specs/2026-11-2x-permissao-execucao-chat-design.md`: escopo, não-objetivos (não desligar a whitelist), modelo de ameaça.
2. **Plano** em `docs/superpowers/plans/`: lista de tarefas com critério de aceite.
3. Implementação com testes **antes** do código (o projeto usa `node --test`, sem Jest).
4. Revisão de segurança: o botão nunca deve permitir (a) input do usuário concatenado no PowerShell — `sanitizeToolArgument()` continua obrigatório; (b) comando sem auditoria em `logs/audit/`; (c) permissão sobrevivendo além do TTL.

**Critério de aceite (proposta):** script gerado pelo agente e fora da biblioteca → chat mostra cartão com prévia + `destructive` → "Permitir uma vez" executa **aquele hash** e nada mais → segunda execução idêntica volta a pedir → log em `logs/audit/` com hash, cliente e timestamp.

---

## Etapa 6 — Skill `pesquisa-ia-recente`

Bloqueada até existir o arquivo real. Desbloqueio:

- **Opção 1:** Jean salva o ZIP do Copilot e informa o caminho → eu inspeciono e instalo em `.agents/skills/pesquisa-ia-recente/`.
- **Opção 2:** eu recrio a partir da estrutura descrita, com `description` em **uma linha** (parser do Mestre/JARVIS não aceita YAML dobrado).

**Critério de aceite:** `GET http://127.0.0.1:3200/api/skills` (JARVIS) ou o índice do Mestre reconhecem a skill, e `SKILLS-INDEX.md` + `skills-lock.json` são atualizados.

---

## Checklist final da sessão

- [x] Pacote auditado antes de executar
- [x] Backup do config criado (o setup não faz)
- [x] Instalação validada com parser estrito (sem BOM)
- [x] `mestre_do_pc` preservado
- [x] Nenhum segredo lido ou ecoado
- [x] Nenhum arquivo do repositório alterado
- [x] Registro local criado (esta pasta), sem commit e sem push
- [ ] **Reiniciar o Claude Desktop** (ação do Jean)
- [ ] Fixar versão `@0.3.4` (Etapa 1)
- [ ] Decidir A/B/C do D5 (Etapa 2)
- [ ] Botão de permissão (Etapa 5)
- [ ] Skill `pesquisa-ia-recente` (Etapa 6)
