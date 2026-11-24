# Operon Engine e Obsidian

O Operon transforma um objetivo em um plano estruturado de genes e o projeta
como Markdown, um manifesto JSON e um JSON Canvas. Não é necessário instalar
Dataview ou Templater.

## Configuração

Crie ou escolha um Vault Obsidian existente e configure seu caminho absoluto
em `MESTRE_OBSIDIAN_VAULT` no ambiente do servidor MCP. Por exemplo, em uma
sessão PowerShell, substitua o caminho abaixo pelo caminho do seu Vault:

```powershell
$env:MESTRE_OBSIDIAN_VAULT = 'D:\Obsidian\MeuVault'
node mcp-server/index.js
```

O caminho é uma configuração local confiável, não é escolhido pelo modelo.
Se estiver vazio ou o Vault estiver indisponível, as operações que acessam o
Vault falham; elas não criam um Vault substituto.

O planejamento usa `OLLAMA_URL` (padrão `http://127.0.0.1:11434`) e
`OLLAMA_MODEL`, respeitando também a configuração existente de perfil e
autenticação do Ollama. Evite `localhost` no Windows: use `127.0.0.1` para o
serviço local. Configurar um servidor remoto ou Ollama Cloud envia o objetivo
ao servidor escolhido; `OLLAMA_API_KEY` ativa a configuração padrão do Ollama
Cloud. Não envie dados sensíveis a um serviço não confiável.

## Fluxo e ferramentas

1. `operon_plan` recebe um objetivo e retorna uma proposta validada, sem
   escrever no Vault. Revise o resultado: a resposta do modelo é não confiável.
2. `operon_validate` valida um plano sem gravar arquivos.
3. Use a prévia de `operon_create` para examinar os arquivos previstos antes
   de executar a criação. Uma execução sem prévia grava apenas no Operon
   correspondente ao slug.
4. `operon_render_canvas` gera o Canvas; `operon_get` e `operon_list`
   consultam Operons existentes.

Exemplos de argumentos nas chamadas MCP:

```json
{"objective":"Organizar a documentação do projeto","constraints":["Manter o plano simples"]}
```

Passe o plano retornado por `operon_plan` à prévia de `operon_create`:

```json
{
  "plan": {
    "name": "Documentação",
    "slug": "documentacao",
    "objective": "Organizar a documentação do projeto",
    "summary": "Inventariar e organizar os documentos.",
    "genes": [
      {
        "key": "inventario",
        "title": "Inventário",
        "type": "task",
        "objective": "Listar documentos existentes.",
        "depends_on": [],
        "priority": "high"
      }
    ]
  },
  "dry_run": true
}
```

Após revisar a prévia, use o mesmo plano com `dry_run: false` para gravar.
Para consultar, use `operon_get` com `{"slug":"documentacao"}` ou
`operon_list` com `{}`. A prévia compara arquivos criados, atualizados,
removidos e inalterados sem modificar o Vault; a chamada MCP ainda pode
registrar um evento de auditoria fora do Vault.

O manifesto é a fonte da verdade do plano. A projeção tem esta estrutura:

```text
Operons/<slug>/
  Promotor.md
  Manifest.json
  Operon.canvas
  Genes/<Gene>.md
```

Os genes podem ser `task`, `knowledge`, `decision`, `resource`, `agent`,
`workflow`, `validation` ou `output`, com prioridade `low`, `medium`, `high`
ou `critical`. Chaves duplicadas, dependências inexistentes, autorreferências,
ciclos e propriedades desconhecidas são rejeitados. IDs estáveis permitem
preservar posições e dimensões dos nodes existentes no Canvas ao atualizar.
Para evitar perda de dados, alterações manuais nos arquivos Markdown gerados
impedem a atualização automática; faça uma cópia antes de reconciliá-las.

## Segurança e limitações

O Ollama é usado apenas para propor o plano; não recebe ferramentas de
filesystem ou execução de comandos. A entrada passa pela proteção existente
contra prompt injection e a saída é validada novamente, independentemente do
modelo. Essa proteção é heurística, não substitui a revisão humana. O modelo
não escolhe o caminho final e nenhuma operação de PowerShell é adicionada.

O módulo restringe caminhos e extensões à pasta do Operon e rejeita traversal,
diretórios reservados e links simbólicos/junctions inseguros. Os arquivos são
preparados e validados antes da substituição, com backup e restauração em caso
de erro. A auditoria registra eventos sem prompts, planos ou credenciais.
Mantenha backups independentes do Vault: falhas de energia, desconexão do disco
e alterações concorrentes externas podem impedir a recuperação automática.
As verificações de caminhos não são um isolamento contra outro processo local
malicioso que altere diretórios simultaneamente; proteja o Vault com as
permissões do sistema operacional e evite acessos concorrentes não confiáveis.
