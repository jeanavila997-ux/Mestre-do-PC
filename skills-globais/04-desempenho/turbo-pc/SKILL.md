---
name: turbo-pc
description: Revisa e turbina o Windows pelo Mestre do PC — diagnóstico só leitura (RAM, memória virtual, disco, temporários, caches, inicialização, energia, GPU) e otimização segura com backup e desfazer. Use quando o usuário pedir para verificar RAM/memória virtual, lixo, pastas temp, ou "turbinar/acelerar o PC".
---

# Turbo PC

Operação `turbo-pc` do Mestre do PC (`scripts/turbo-pc.ps1`).

## Regras
- **Diagnóstico primeiro**, sempre: `mestre_turbo_diagnostico` (MCP, classe leitura), operação `turbo_pc_diagnostico` ou `npm run turbo:diagnostico`. Copie os números como vieram.
- **Otimizar só depois do "sim" explícito**: `mestre_turbo_otimizar` com `confirmar=true` (classe destrutiva), operação `turbo_pc_otimizar` ou `node scripts/mestre-cli.js turbo otimizar --confirmar`. Sem confirmação ele só lista o que faria.
- Nunca: esvaziar a Lixeira, apagar Downloads/Documentos/Desktop, apagar modelos do Ollama, limpar o cache npm, reiniciar o PC ou encerrar processos.
- Pagefile fica automático; agendamento de GPU por hardware só é reportado.

## O que o otimizar faz
1. Backup em `%USERPROFILE%\Projetos\_arquivo\turbo-AAAAMMDD\` (`estado-anterior.json`, `.reg`, diagnóstico antes).
2. Limpa `%TEMP%` (>24h, pula em uso), crash dumps (>7 dias), miniaturas, `pnpm store prune`, `pip cache purge`, `uv cache prune`.
3. Alto desempenho quando na tomada (registra o plano anterior).
4. GPU por app (`HKCU\Software\Microsoft\DirectX\UserGpuPreferences`): Ollama/llama/python na RTX; Chrome, Edge, Obsidian, VS Code e Electron no iGPU.
5. Modo de Jogo ligado; efeitos visuais para desempenho mantendo fontes suaves.
6. Desativa só inicializações claramente dispensáveis via `StartupApproved` (reversível); duvidosos só são listados.
7. Gera `desfazer.ps1`, `rodar-como-admin.ps1` (ponto de restauração, Windows\Temp, DISM, cache do Windows Update, retrim, compressão de memória) e `relatorio.md/json`.

## Desfazer
`powershell -NoProfile -ExecutionPolicy Bypass -File <pasta>\desfazer.ps1` — restaura registro e plano de energia. Arquivos temporários apagados não voltam (os apps recriam).
