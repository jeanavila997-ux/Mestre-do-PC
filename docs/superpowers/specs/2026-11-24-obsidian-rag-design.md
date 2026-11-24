# Memória RAG local do Obsidian — desenho aprovado

Data: 2026-11-24

## Objetivo

Adicionar memória semântica local do Obsidian ao Mestre do PC, exposta por MCP e disponível na CLI `npm run ia`, sem novas dependências e sem enviar notas a serviços externos.

## Decisões aprovadas

- Módulo ESM `mcp-server/obsidian-memory.js`, usando somente Node e `fetch`.
- Vault padrão `%USERPROFILE%\Projetos`, configurável por `OBSIDIAN_VAULT_PATH`.
- Índice JSON local em `v10/data/memories`, configurável por `MESTRE_OBSIDIAN_INDEX_DIR` para testes.
- Ollama em `http://127.0.0.1:11434`, endpoint `/api/embed`, modelo `nomic-embed-text`, configuráveis por `OBSIDIAN_OLLAMA_URL` e `OBSIDIAN_EMBED_MODEL`. A memória rejeita endpoint remoto; a CLI também recusa modelo generativo remoto ao usar evidências.
- Chunks com hash SHA-256; arquivos inalterados reutilizam embeddings. Mudança de modelo invalida os vetores antigos.
- Busca por cosseno, cinco resultados por padrão, limite máximo dez, com score, fonte relativa, data e trecho limitado.
- Tools MCP `search_obsidian` e `sync_obsidian`, implementadas em processo, sem shell e sem entradas em `allowed-operations.json`.
- CLI: `npm run ia -- "pergunta" --memoria`; sincronização explícita por `--sincronizar-memoria`.
- Notas são dados não confiáveis: o contexto enviado ao modelo inclui essa advertência e citações. Não são instruções nem verdade absoluta.
- Prefixo `[Memória Obsidian] 🧠` somente quando resultados forem usados; resposta com resumo das evidências, sem exposição de raciocínio interno.

## Proteções

- Ignora `.git`, `.obsidian`, `.trash`, `node_modules`, `Referencias`, cofres e nomes sensíveis conhecidos.
- Não segue links simbólicos/junctions; limita tamanho, quantidade e profundidade dos arquivos.
- Não lê `.env` diretamente e não grava segredos no índice ou logs.
- Ollama e filesystem são injetáveis nos testes; nenhuma nota real ou chamada externa é usada na suíte.
- Nenhum commit, push, download de modelo ou instalação automática.

## Reparo de estrutura

A cópia com `.git` está sem `v10/`; a cópia ativa contém esses arquivos. Restaurar apenas caminhos rastreados ausentes, por cópia e verificação de hash, sem mover/apagar a origem. As mudanças novas serão aplicadas à cópia versionada e espelhadas na cópia ativa quando couber.

## Validação

Testes `node:test` cobrem chunking, cosseno, filtros, sync incremental, mudança de modelo, busca, entradas inválidas, tools MCP e CLI com Ollama simulado. Verificação final inclui sintaxe, testes focados e smoke MCP real sobre um vault fixture.
