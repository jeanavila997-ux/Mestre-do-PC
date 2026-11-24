# Plano: Ferramentas e Administração na extensão do Mestre (v1.2.0)

Pedido do Jean em 21/11/2026: extrair informações da página, mudar design, instalação de
DevTools, abrir DevTools, modo dev, JSON, abrir NotebookLM e abrir o notebook da Microsoft
(OneNote). Depois: comandos de administração.

Branch `feat/extensao-ferramentas-20261121`, empilhada em `feat/turbo-pc-20261121` (#73).

## Onde fica

- Popup: seções **🧰 Ferramentas** e **🛡️ Administração** (recolhíveis).
- Botão direito: **Mestre do PC: Ferramentas** e **Mestre do PC: Administração** com submenus.
- Os dois abrem `tools.html`, um painel em janela própria que age na aba onde você clicou
  (permissão `activeTab`, sem `host_permissions` amplas).

## 1. Ler a página

- 📋 Extrair lista: tabelas, listas, links, e-mails, telefones, preços, títulos. Escolhe o
  tipo, vê a tabela, copia (TSV para Excel/Sheets), baixa CSV (`;`, BOM, proteção contra
  fórmula) ou JSON.
- 🧾 JSON: página JSON formatada com busca e copiar; resumo em JSON de qualquer página
  (título, URL, meta, cabeçalhos, contagens, extraídos); enviar o resumo para a IA do
  Mestre pelo mesmo fluxo/consentimento do "Enviar página para IA".

## 2. Visual

- 🎨 Temas (Escuro, Neon ciano JARVIS, Leitura limpa, Alto contraste), fonte (70–200%),
  largura do texto, esconder anúncios/banners. Só CSS num `<style id="mestre-do-pc-design">`.
- Salvo por origem em `chrome.storage.local` (`designPorSite`), botão Restaurar.
- Reaplicação: ao abrir o popup no site (activeTab) ou, se o Jean ligar, em todo carregamento
  com a permissão opcional `http(s)://*/*`.

## 3. Desenvolvedor

- 🛠️ Abrir DevTools: extensão não pode abrir; mostra F12/Ctrl+Shift+I e oferece
  `browser_enviar_f12` no launcher (só envia F12 se a janela em foco for navegador).
- 🧪 Modo dev: frameworks, erros do console desde a abertura do painel (hook no mundo MAIN),
  Navigation/Paint Timing, cookies só por nome (marca nomes sensíveis; nunca valores),
  chaves de storage, recarregar sem cache, limpar dados do site (checkbox + confirm),
  abrir `edge://extensions`/`chrome://extensions`.
- 📦 Extensões de dev: links verificados da Chrome Web Store (React, Vue, Redux, Lighthouse,
  Wappalyzer, JSON Formatter — o "JSON Viewer" antigo saiu da loja).

## 4. Apps

- 📓 NotebookLM em nova aba + copiar o link da página para usar como fonte.
- 🗒️ OneNote: `browser_abrir_onenote` no launcher (app instalado, protocolo `onenote:` ou web);
  sem launcher abre a web. "Copiar página como nota" (título, link e seleção) sem login.

## 5. Administração

Operações fixas `admin_*` (categoria "Administração", `scripts/admin-tools.ps1`). Classes
leitura / execução / destrutiva. Elevação sempre por `Start-Process -Verb RunAs` (UAC visível).
Confirmação no painel para tudo que eleva, executa ou é destrutivo; confirmação dupla para
reiniciar/desligar o PC (agendados em 60 s, com cancelar). No catálogo/MCP, tudo que pede
confirmação fica `destructive: true` (destructiveHint). Fora do escopo de propósito: esvaziar
Lixeira, apagar arquivos pessoais, desligar Defender/UAC/firewall.

## Testes

- `browser-extension/tools-core.test.js`: extração, CSV, JSON, temas, cookies, catálogo admin.
- `mcp-server/test/extensao-ferramentas.test.js` e `mcp-server/test/admin-ops.test.js`.
- `npm test` na extensão e na raiz, `node build.js chrome|firefox`.

## Limitações conhecidas

- Páginas internas (`edge://`, `chrome://`) e lojas de extensão não aceitam scripts.
- Cookies HttpOnly não aparecem nem são limpos (precisaria da permissão `browsingData`).
- Firefox não abre `about:addons` por extensão; o painel copia o endereço.
- F12 pelo launcher depende do foco da janela; se falhar, aperte F12.
