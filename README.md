# Mestre do PC V10

[![Website](https://img.shields.io/badge/Website-Live%20Demo-00d4ff?style=for-the-badge&logo=googlechrome)](https://jeanavila997-ux.github.io/Mestre-do-PC-V10/index.html)
[![Hostinger](https://img.shields.io/badge/Hostinger-vitrinedeapps.cloud-FFD700?style=for-the-badge&logo=cloudflarepages)](https://vitrinedeapps.cloud)
[![GitHub Repository](https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github)](https://github.com/jeanavila997-ux/Mestre-do-PC-V10)
[![Git Clone](https://img.shields.io/badge/Git-Clone%20HTTPS-1081C2?style=for-the-badge&logo=git)](https://github.com/jeanavila997-ux/Mestre-do-PC-V10.git)
[![Issues](https://img.shields.io/github/issues/jeanavila997-ux/Mestre-do-PC-V10?style=for-the-badge)](https://github.com/jeanavila997-ux/Mestre-do-PC-V10/issues)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078D6?style=for-the-badge&logo=windows)](https://github.com/jeanavila997-ux/Mestre-do-PC-V10)

Aplicativo local de diagnóstico, manutenção e automação do Windows com interface web V10, integração opcional com IA local (Ollama) e servidor MCP (*Model Context Protocol*).

---

## 🔗 Links Oficiais do Projeto

- 🌍 **Website Oficial (GitHub Pages):** [https://jeanavila997-ux.github.io/Mestre-do-PC-V10/index.html](https://jeanavila997-ux.github.io/Mestre-do-PC-V10/index.html)
- 🌟 **Mirror Hostinger:** [https://avilamix.shop](https://avilamix.shop)
- 🌐 **Repositório GitHub:** [https://github.com/jeanavila997-ux/Mestre-do-PC-V10](https://github.com/jeanavila997-ux/Mestre-do-PC-V10)
- 📦 **Clone URL:** `https://github.com/jeanavila997-ux/Mestre-do-PC-V10.git`
- 🐛 **Reportar Problemas / Issues:** [https://github.com/jeanavila997-ux/Mestre-do-PC-V10/issues](https://github.com/jeanavila997-ux/Mestre-do-PC-V10/issues)
- 🔀 **Pull Requests:** [https://github.com/jeanavila997-ux/Mestre-do-PC-V10/pulls](https://github.com/jeanavila997-ux/Mestre-do-PC-V10/pulls)
- 🖥️ **Painel Local:** `http://127.0.0.1:7777` *(quando o launcher estiver ativo)*

---

## 🚀 Principais Recursos

- **Diagnóstico Completo:** Análise em tempo real de memória RAM, disco, processos, rede e saúde do sistema.
- **Limpeza e Reparo:** Automação de tarefas de manutenção, limpeza de arquivos temporários e otimização do Windows.
- **Servidor MCP Integrado:** Mais de 480 ferramentas publicadas via protocolo MCP (`stdio` e `HTTP-SSE`) para assistentes como Claude Code, VS Code, Codex e Google Antigravity SDK.
- **Integração com IA (Ollama):** Suporte nativo a modelos locais e cloud (Qwen, Kimi, GLM, Gemma, etc.) para análise de logs e suporte interativo.
- **Execução Segura:** Controle estrito via whitelist (`v10/allowed-operations.json`), validação de tokens e auditoria com logs.

---

## 💻 Requisitos do Sistema

- **Sistema Operacional:** Windows 10 ou Windows 11 (64 bits).
- **Shell:** PowerShell 5.1 ou PowerShell 7+ (pwsh).
- **Node.js:** Versão **22.13.0** ou superior.
- **Ollama (Opcional):** Para recursos de IA generativa e assistência inteligente local.

---

## 📥 Instalação e Desenvolvimento

### 1. Clonar o Repositório

```powershell
git clone https://github.com/jeanavila997-ux/Mestre-do-PC-V10.git
cd Mestre-do-PC-V10
```

### 2. Configurar o Servidor MCP

```powershell
cd mcp-server
npm ci
npm test
```

### 3. Iniciar o Painel / Launcher Local (V10)

```powershell
cd ..\v10
npm install
npm start
```

Ou execute o script de inicialização rápida:
```powershell
.\start-mestre.bat
```

---

## 🤖 MESTRE EXTENSSAO — CLI local com IA

A CLI usa o Ollama configurado em `.env.local`, responde em português e grava
logs rotativos em `logs/mestre-cli.log`. Para ativar, copie `.env.example` para
`.env.local` e ajuste o modelo desejado.

O modelo da CLI vem de `MESTRE_CLI_MODEL` (padrão `qwen3.5:4b-text`). `OLLAMA_MODEL`
é o modelo do launcher e do servidor MCP (padrão `qwen2.5-coder:3b-instruct`) e só
vale para a CLI quando `MESTRE_CLI_MODEL` está vazio.

```powershell
Copy-Item .env.example .env.local
npm run cli:status
npm run ia -- "Analise a arquitetura do Mestre do PC"
```

Também é possível escolher o modelo ou receber o JSON completo:

```powershell
npm run ia -- "Explique este erro" --model deepseek-coder:6.7b
npm run ia -- "Resuma este projeto" --json
```

Use `npm run test:cli` para validar somente a MESTRE EXTENSSAO.

### Memória local do Obsidian

O MCP expõe `sync_obsidian` e `search_obsidian`. O vault padrão é
`%USERPROFILE%\Projetos`, configurável por `OBSIDIAN_VAULT_PATH`. O índice fica em
`v10/data/memories`, fora do Git, e usa `nomic-embed-text` no endpoint local exclusivo
`OBSIDIAN_OLLAMA_URL` (padrão `http://127.0.0.1:11434`). Se o modelo ainda não existir,
instale-o separadamente com `ollama pull nomic-embed-text`.

```powershell
# Atualiza somente os arquivos novos ou modificados
npm run ia -- --sincronizar-memoria

# Usa até cinco evidências locais, com fonte e data, na resposta
npm run ia -- "O que decidimos sobre a arquitetura?" --memoria
```

Pastas protegidas, `Referencias/`, dependências, links simbólicos e arquivos sensíveis
ficam fora do índice. As notas são enviadas ao modelo como evidências não confiáveis,
não como instruções. A CLI recusa modelo remoto ao usar `--memoria`; no MCP, os trechos
retornados são entregues ao cliente que fez a chamada. Quando há resultados, a CLI marca
a resposta com `[Memória Obsidian] 🧠`.

No Chat Integrado, a busca automática usa o índice existente somente quando o provedor é
local e `search_obsidian` está ativa; ela não reindexa o vault a cada mensagem. O catálogo
ao vivo separa chat de embeddings e pode ser conferido com `npm run models:live`.

### Voz Kokoro

As respostas do chat têm o botão **🔊 Kokoro**, que usa o Voicebox local em
`http://127.0.0.1:17493` e o perfil Dora pt-BR. A síntese só ocorre após o clique. A primeira
ativação pede consentimento explícito para o possível download do modelo Kokoro (~350 MB);
cancelar não chama o serviço. Nenhum áudio ou texto é enviado a um endpoint remoto por essa
integração.

---

## OpenCode Go no chat

O chat integrado pode usar o [OpenCode Go](https://opencode.ai/v2/docs/console/go/) (assinatura v2) como provedor. A chamada fica no launcher, no mesmo cliente HTTP dos outros provedores compatíveis com OpenAI: `POST {base}/chat/completions` com `Authorization: Bearer`.

Copie as variáveis para `.env.local` (nunca commite a chave):

| Variável | Função |
|---|---|
| `OPENCODE_GO_API_KEY` | Chave do console (`oc_sk_…`). Sem ela o provedor fica **não configurado**. |
| `OPENCODE_GO_BASE_URL` | Opcional. Padrão: `https://opencode.ai/inference/go/openai/v1`. É o único jeito de apontar outro host. A URL salva na tela só é aceita em `https` com host `opencode.ai`. |
| `OPENCODE_GO_MODEL` | Opcional. Padrão: `kimi-k2.7-code`. |

No chat, abra o seletor de modelo e escolha **OpenCode Go**. A página **Configurar API** (`/chaves-api.html`) mostra o mesmo estado. O Go exige o header `x-opencode-session`; o launcher envia um id estável por conversa.

## JARVIS no chat integrado

O JARVIS aparece no mesmo seletor de provedores do chat. No PC, use `JARVIS_URL=http://127.0.0.1:3200`; não é necessário login. Para a VPS, use uma URL HTTPS e mantenha `JARVIS_USER` e `JARVIS_PASS` apenas no `.env.local` do launcher. A interface nunca recebe a senha.

O launcher envia `POST /api/chat` com `X-Jarvis: 1`, interpreta o fluxo NDJSON do JARVIS e o converte para o SSE já entendido pelo chat integrado. Isso adiciona conversação e roteamento; comandos administrativos continuam protegidos pelas confirmações e pela whitelist do Mestre.

## 🛡️ Segurança e Whitelist

O launcher executa exclusivamente comandos cadastrados na whitelist em [`v10/allowed-operations.json`](v10/allowed-operations.json).
- Comandos com parâmetros são sanitizados para evitar injeção.
- O Modo Livre é estritamente opt-in e requer aprovação explícita para cada execução.
- Todas as ações são auditadas e salvas em `logs/audit/`.

Consulte o arquivo [SECURITY.md](SECURITY.md) para diretrizes de segurança completas.

---

## 📂 Estrutura do Repositório

| Diretório | Descrição |
| :--- | :--- |
| [`v10/`](v10/) | Interface web do usuário e backend do launcher local (`127.0.0.1:7777`). |
| [`mcp-server/`](mcp-server/) | Servidor MCP com mais de 480 ferramentas de automação e integração de IA. |
| [`dist/site/`](dist/site/) | Landing page e documentação estática do projeto. |
| [`docs/`](docs/) | Guias de arquitetura, instalação, segurança e integrações. |
| [`scripts/`](scripts/) | Scripts utilitários de automação, validação e sincronização Git. |
| [`browser-extension/`](browser-extension/) | Extensão para navegadores (Chrome / Firefox). |
| [`startup/`](startup/) | Atalhos e arquivos de inicialização do sistema. |

---

## 📝 Integrações Adicionais

- **Notepad++:** O Mestre do PC pode ser acionado diretamente pelo Notepad++ para explicar código, analisar logs e sugerir comandos. Consulte [docs/notepad-plus-plus-integration.md](docs/notepad-plus-plus-integration.md).
- **Extensão de Navegador:** Integração rápida via [browser-extension/README.md](browser-extension/README.md).

---

## 📜 Licença

Distribuído sob a licença **MIT**. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

---
*Desenvolvido por **Jean Carlos de Avila** — [GitHub @jeanavila997-ux](https://github.com/jeanavila997-ux)*
