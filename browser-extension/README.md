# Extensão do navegador - Mestre do PC V10

Extensão Manifest V3 para integrar o navegador com o **Mestre do PC V10** e, opcionalmente, com outros apps locais como **Chat Hub**.

## Funcionalidades

- Ver status do Launcher, Ollama e Chat Hub.
- Executar comandos rápidos pelo popup: diagnóstico, limpeza, enviar página para IA.
- Speedtest (fast.com + Cloudflare), listar/memória das abas, fechar sucata/duplicadas, descartar inativas.
- Menu de contexto: diagnóstico, limpeza, speedtest, abas e análise de texto selecionado.
- Configuração segura por token (`MESTRE_EXTENSION_TOKEN`).
- Atalho de instalação unpacked: `pwsh -File browser-extension/INSTALAR-UNPACKED.ps1`.

### 🧰 Ferramentas (v1.2.0)

Ficam no popup (seção **Ferramentas**) e no botão direito (**Mestre do PC: Ferramentas**).
Abrem um painel em janela própria que age na aba onde você clicou.

- 📋 **Extrair lista de informações:** tabelas, listas, links, e-mails, telefones, preços
  e títulos. Copiar (cola no Excel/Sheets), baixar CSV (`;`, UTF-8 com BOM) ou JSON.
- 🧾 **JSON:** se a página for JSON, mostra formatado com busca e copiar. Em qualquer
  página gera um **resumo em JSON** (título, URL, meta, cabeçalhos, contagens e dados
  extraídos) e pode mandar esse resumo para a IA do Mestre (mesmo consentimento do
  "Enviar página para IA").
- 🎨 **Mudar design:** temas Escuro, Neon ciano (JARVIS), Leitura limpa e Alto contraste;
  tamanho da fonte, largura do texto e esconder anúncios/banners. Só CSS injetado num
  `<style>` próprio; nada é alterado no site. Salvo por site em `chrome.storage.local`,
  com botão **Restaurar original**. Opcional: reaplicar sozinho ao abrir o site (pede
  permissão de host opcional `http(s)://*/*`).
- 🧪 **Modo dev:** frameworks detectados, erros do console capturados desde a abertura do
  painel, tempos (Navigation/Paint Timing), cookies (só nomes e contagem, nunca valores),
  chaves do localStorage/sessionStorage, recarregar sem cache, limpar dados do site
  (caixa de confirmação + confirmação final) e abrir a página de extensões.
- 🛠️ **DevTools:** atalhos F12 / Ctrl+Shift+I; com o Mestre no ar, o botão pede ao launcher
  (`browser_enviar_f12`) para apertar F12, e ele só envia se a janela em foco for um navegador.
  Lista de extensões de desenvolvedor com link da Chrome Web Store (React, Vue, Redux,
  Lighthouse, Wappalyzer e JSON Formatter).
- 📓 **NotebookLM** (nova aba + copiar o link da página para usar como fonte) e 🗒️ **OneNote**
  (app via launcher `browser_abrir_onenote`, ou a web) com "copiar página como nota".

### 🛡️ Administração

Seção **Administração** no popup e no botão direito. Cada item chama uma operação fixa
do launcher (`admin_*`, categoria "Administração" em `v10/allowed-operations.json`,
script `scripts/admin-tools.ps1`); a extensão nunca manda comando livre.

- Classes: **leitura**, **execução** e **destrutiva**. Tudo que precisa de administrador abre
  uma janela com UAC visível (`Start-Process -Verb RunAs`).
- Itens de execução, destrutivos ou elevados exigem marcar "Li o que esta operação faz".
  Reiniciar/desligar o PC exigem confirmação dupla (digitar REINICIAR/DESLIGAR + confirmar)
  e são agendados em 60 s, com botão para cancelar.
- Não há comandos para esvaziar a Lixeira, apagar arquivos pessoais ou desligar
  Defender, UAC ou firewall.

## Segurança

A extensão só consegue falar com o launcher se:

1. A variável `MESTRE_EXTENSION_TOKEN` estiver definida no ambiente do launcher.
2. A origem da extensão (`chrome-extension://<id>` ou `moz-extension://<id>`) estiver na allowlist `MESTRE_EXTENSION_ORIGINS`.
3. As requisições enviarem os headers `X-Mestre-Client: browser-extension` e `X-Mestre-Extension-Token: <token>`.

Nunca compartilhe o token. Ele é a única credencial da extensão.

Token e configurações ficam em `chrome.storage.local`, sem sincronização entre
dispositivos. Dados de versões anteriores são copiados para armazenamento local
antes de serem removidos de `storage.sync`. Armazenamento local não é cofre criptografado.
Somente URLs HTTP em `127.0.0.1` são aceitas; redirecionamentos são bloqueados.

## Instalação

### 1. Configurar o Launcher

No PowerShell onde o launcher é iniciado, defina o token e as origens permitidas:

```powershell
$env:MESTRE_EXTENSION_TOKEN="seu-token-seguro-aqui"
$env:MESTRE_EXTENSION_ORIGINS="chrome-extension://SEU_ID_AQUI"
node v10/launcher.js
```

> Para descobrir o ID da extensão, carregue-a primeiro no modo desenvolvedor (passo 3) e depois copie o ID exibido.

Você pode permitir múltiplas origens separando por vírgula:

```powershell
$env:MESTRE_EXTENSION_ORIGINS="chrome-extension://ID_CHROME, moz-extension://ID_FIREFOX"
```

### 2. Gerar ícones (se necessário)

Os ícones PNG já estão em `icons/`. Para regenerá-los:

```bash
node browser-extension/icons/build-icons.js
```

### 3. Carregar no Chrome / Edge

1. Abra `chrome://extensions/` (ou `edge://extensions/`).
2. Ative o **Modo desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta `browser-extension`.
5. Copie o ID da extensão e adicione-o em `MESTRE_EXTENSION_ORIGINS`.

### 4. Configurar a extensão

1. Clique no ícone da extensão → **⚙️ Configurações**.
2. Cole o mesmo token definido no launcher.
3. (Opcional) Habilite e configure a URL do Chat Hub.
4. Salve.
5. Para usar IA, leia o aviso e marque **Autorizar envio para IA**. O envio de título,
   URL e seleção fica bloqueado até esse consentimento, inclusive no menu de contexto.

Portas locais adicionais exigem permissão opcional do navegador ao salvar.
HTTP é usado apenas no loopback deste computador; servidores remotos não são aceitos.

## Integração com Chat Hub

Por padrão a extensão verifica o status de `http://127.0.0.1:3000/ping`. Para usar outro app local, altere a URL nas opções da extensão e certifique-se de que o app responda em `GET /ping`.

## Distribuição

Requisitos: Node.js e PowerShell do Windows. A extensão não depende de pacotes npm externos; não precisa de `npm install`.

Para validar e gerar os pacotes:

```bash
# Chrome / Edge
node --test browser-extension/build.test.js browser-extension/settings.test.js
node browser-extension/build.js chrome

# Firefox
node browser-extension/build.js firefox
```

O arquivo será gerado em `browser-extension/dist/mestre-do-pc-extension-<target>-v<versao>.zip`.

O build valida nome, descrição (até 132 caracteres), versão e presença dos recursos.
O `manifest.json` fica na raiz do ZIP. Arquivos obrigatórios ausentes interrompem o
build sem substituir o ZIP anterior. O pacote Firefox recebe seu próprio manifesto.

### Antes de enviar à Chrome Web Store

1. Extraia o ZIP e carregue a pasta extraída em `chrome://extensions/` pelo botão **Carregar sem compactação**.
2. Configure token e origem no launcher. Confira status, opções, popup, menu de contexto e envio para IA; teste limpeza apenas quando quiser executá-la.
3. Revise nome, descrição e ícones PNG (16, 32, 48 e 128 pixels). A versão atual é `1.0.2`; cada envio posterior exige uma versão maior nos dois manifestos e em `package.json`.
4. Prepare descrição da loja, capturas de tela, imagens promocionais, URLs de suporte/privacidade e declarações sobre permissões e dados enviados para IA.
5. Envie o ZIP pelo painel da conta de desenvolvedor quando todos os testes e materiais estiverem completos.

Como os textos estão diretamente em português e não existe pasta `_locales`, o manifesto não declara `default_locale`.
O ZIP gerado não comprova aprovação da loja nem substitui teste funcional no navegador.

Referências oficiais: [preparar extensão](https://developer.chrome.com/docs/webstore/prepare),
[default_locale](https://developer.chrome.com/docs/extensions/reference/manifest/default-locale),
[página da loja](https://developer.chrome.com/docs/webstore/best_listing).

Texto sugerido, categoria e minuta de privacidade: [STORE-LISTING.md](STORE-LISTING.md).

### Teste no Chrome

```powershell
npm.cmd --prefix browser-extension run test:e2e
```

O teste usa Chrome instalado e Puppeteer já incluído no `chrome-devtools-mcp` do
projeto. Abre perfil temporário, verifica migração do token, consentimento, opções
e comando com resposta simulada. Não executa manutenção real. `CHROME_PATH` permite
indicar outro executável do Chrome. Firefox é validado no pacote, não neste teste.

Sem script permanente nas páginas, não há listeners `unload`, WebSockets ou WebRTC
injetados pela extensão. Botões do popup funcionam enquanto consultas de status
ocorrem em paralelo. Testes manuais de navegação voltar/avançar, diferentes versões
do navegador e rede lenta continuam parte da revisão antes da publicação.

### Firefox

O Firefox usa o arquivo `manifest-firefox.json` durante o build. A principal diferença é que o background usa `scripts` em vez de `service_worker`, e inclui `browser_specific_settings` com o ID da extensão.

## Desenvolvimento

Arquivos principais:

- `manifest.json` — configuração da extensão (Chrome/Edge).
- `manifest-firefox.json` — configuração da extensão (Firefox).
- `popup.html` / `popup.js` — interface e ações do popup.
- `background.js` — service worker, menu de contexto e chamadas ao launcher.
- `settings.js` — armazenamento local, migração e acesso ao app local.
- `options.html` / `options.js` — página de configurações.
- `build.js` — script de empacotamento.
- `tools.html` / `tools.js` — painel de Ferramentas e Administração.
- `tools-core.js` — funções puras (extração, CSV, JSON, temas, catálogo de administração), testadas em `tools-core.test.js`.
- `page-scripts.js` — funções injetadas na aba com `chrome.scripting` (autocontidas).
- `tools-actions.js` — design por site e abertura do painel.
- `mestre-api.js` — chamadas ao launcher (`/run`, `/run-status`, `/ollama/chat`).

## Permissões

- `storage`: salvar token, URLs e consentimento neste perfil.
- `activeTab`: obter a aba ativa para enviar página/selection.
- `contextMenus`: menu de contexto.
- `scripting`: extrair seleção da página.
- `host_permissions`: acesso apenas a `http://127.0.0.1:7777/*` (launcher local).
- `notifications`: resultados e erros das ações do menu de contexto.
- `optional_host_permissions`: outras portas de `127.0.0.1`, solicitadas ao configurar apps locais;
  `http(s)://*/*` só se você ligar "Reaplicar sozinho ao abrir o site" no Design.

Não há `content_scripts` nem recursos públicos em `<all_urls>`. A leitura da página
usa `activeTab` e `scripting` somente após ação explícita (popup ou botão direito).
Sem a permissão opcional, o design salvo é reaplicado quando você abre o popup no site.

## Atualizar a extensão carregada sem compactação

Depois de `git pull`, abra `edge://extensions` (ou `chrome://extensions`) e clique em
**Recarregar** (↻) no card "Mestre do PC - Integração". O token e as opções ficam.
