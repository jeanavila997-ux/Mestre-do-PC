/**
 * Funções puras das Ferramentas da extensão (sem chrome.*), testáveis no Node.
 * Usadas por tools.js, popup.js e background.js.
 */

export const EXTRACT_TYPES = [
  { id: "tabelas", label: "Tabelas" },
  { id: "listas", label: "Listas" },
  { id: "links", label: "Links" },
  { id: "emails", label: "E-mails" },
  { id: "telefones", label: "Telefones" },
  { id: "precos", label: "Preços" },
  { id: "titulos", label: "Títulos (h1–h6)" },
];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;
// Telefones BR e internacionais: (68) 99999-9999, +55 68 3224-0000, 0800 123 4567.
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)?(?:9\s?)?\d{4}[\s.-]?\d{4}\b/g;
const PRICE_RE = /(?:R\$|US\$|\$|€|£)\s?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})?(?!\d)|(?:R\$|US\$|\$|€|£)\s?\d+(?:[.,]\d{2})?(?!\d)/g;

function uniq(list) {
  return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
}

export function findEmails(text = "") {
  return uniq(String(text).match(EMAIL_RE) || []).map((e) => e.replace(/\.$/, ""));
}

export function findPhones(text = "") {
  const found = String(text).match(PHONE_RE) || [];
  return uniq(found.filter((p) => {
    const digits = p.replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15;
  }));
}

export function findPrices(text = "") {
  return uniq(String(text).match(PRICE_RE) || []);
}

function csvCell(value) {
  const s = value == null ? "" : String(value);
  // Evita injeção de fórmula no Excel/Sheets.
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[";\n\r,]/.test(safe) ? '"' + safe.replaceAll('"', '""') + '"' : safe;
}

/** Converte linhas (arrays) em CSV com ; (padrão do Excel em pt-BR). */
export function toCsv(rows, sep = ";") {
  return rows.map((row) => row.map(csvCell).join(sep)).join("\r\n");
}

/**
 * Normaliza os dados brutos extraídos da página para um tipo escolhido.
 * Retorna { headers, rows } pronto para tabela/CSV.
 */
export function rowsForType(type, raw = {}) {
  const text = raw.text || "";
  switch (type) {
    case "tabelas": {
      const rows = [];
      (raw.tables || []).forEach((table, i) => {
        table.forEach((cells) => rows.push([`Tabela ${i + 1}`, ...cells]));
      });
      const width = Math.max(1, ...rows.map((r) => r.length - 1));
      return { headers: ["tabela", ...Array.from({ length: width }, (_, i) => `col${i + 1}`)], rows };
    }
    case "listas": {
      const rows = [];
      (raw.lists || []).forEach((items, i) => items.forEach((item) => rows.push([`Lista ${i + 1}`, item])));
      return { headers: ["lista", "item"], rows };
    }
    case "links":
      return { headers: ["texto", "url"], rows: (raw.links || []).map((l) => [l.text, l.href]) };
    case "emails":
      return { headers: ["email"], rows: uniq([...(raw.mailtos || []), ...findEmails(text)]).map((e) => [e]) };
    case "telefones":
      return { headers: ["telefone"], rows: uniq([...(raw.tels || []), ...findPhones(text)]).map((t) => [t]) };
    case "precos":
      return { headers: ["preco"], rows: findPrices(text).map((p) => [p]) };
    case "titulos":
      return { headers: ["nivel", "titulo"], rows: (raw.headings || []).map((h) => [h.level, h.text]) };
    default:
      throw new Error(`Tipo de extração inválido: ${type}`);
  }
}

export function rowsToObjects({ headers, rows }) {
  return rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])));
}

/** Tenta interpretar o texto como JSON. Retorna { ok, value, error }. */
export function tryParseJson(text) {
  const s = String(text ?? "").trim();
  if (!s || !/^[[{"]|^(true|false|null|-?\d)/.test(s)) return { ok: false, error: "Não parece JSON." };
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function formatJson(value, indent = 2) {
  return JSON.stringify(value, null, indent);
}

/** Linhas (1-based) do JSON formatado que contêm o termo (sem diferenciar maiúsculas). */
export function searchLines(pretty, term) {
  const t = String(term || "").toLowerCase();
  if (!t) return [];
  return String(pretty).split("\n").flatMap((line, i) => (line.toLowerCase().includes(t) ? [i + 1] : []));
}

/** Resumo em JSON da página a partir dos dados brutos. */
export function buildPageSummary(raw = {}) {
  const text = raw.text || "";
  return {
    titulo: raw.title || "",
    url: raw.url || "",
    idioma: raw.lang || "",
    meta: raw.meta || {},
    cabecalhos: (raw.headings || []).slice(0, 50),
    contagem: {
      links: (raw.links || []).length,
      tabelas: (raw.tables || []).length,
      listas: (raw.lists || []).length,
      imagens: raw.images || 0,
      palavras: text ? text.split(/\s+/).filter(Boolean).length : 0,
    },
    extraidos: {
      emails: rowsForType("emails", raw).rows.map((r) => r[0]).slice(0, 50),
      telefones: rowsForType("telefones", raw).rows.map((r) => r[0]).slice(0, 50),
      precos: findPrices(text).slice(0, 50),
    },
    geradoEm: raw.generatedAt || new Date().toISOString(),
  };
}

/** Prompt curto para mandar o resumo à IA local do Mestre. */
export function summaryPrompt(summary, maxChars = 6000) {
  const body = formatJson(summary).slice(0, maxChars);
  return `Analise este resumo em JSON de uma página web. Diga do que se trata, os pontos principais e ações úteis (automação, organização ou manutenção), em pt-BR:\n\n${body}`;
}

/* ---------- Design ---------- */

export const THEMES = {
  nenhum: { label: "Original", css: "" },
  escuro: {
    label: "Escuro",
    css: `html{filter:invert(.92) hue-rotate(180deg)!important;background:#111!important}
img,video,picture,canvas,svg image,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important}`,
  },
  jarvis: {
    label: "Neon ciano (JARVIS)",
    css: `html,body{background:#05080d!important;color:#cfefff!important}
body *{background-color:transparent!important;color:inherit!important;border-color:#0e3a4a!important}
a,a *{color:#00e5ff!important;text-shadow:0 0 6px rgba(0,229,255,.55)}
h1,h2,h3,h4,h5,h6{color:#7ff6ff!important;text-shadow:0 0 8px rgba(0,229,255,.6)}
button,input,select,textarea{background:#0a1520!important;color:#cfefff!important;border:1px solid #00b8d4!important}
::selection{background:#00e5ff;color:#001018}`,
  },
  leitura: {
    label: "Leitura limpa",
    css: `html,body{background:#fbf8f1!important;color:#222!important}
body{font-family:Georgia,"Times New Roman",serif!important;line-height:1.7!important}
body *{background-color:transparent!important;box-shadow:none!important}
p,li{color:#222!important}
a{color:#0b5cad!important}`,
  },
  contraste: {
    label: "Alto contraste",
    css: `html,body{background:#000!important;color:#fff!important}
body *{background-color:#000!important;color:#fff!important;border-color:#fff!important}
a,a *{color:#ff0!important;text-decoration:underline!important}
img{filter:contrast(1.2)}
:focus{outline:3px solid #0ff!important}`,
  },
};

export const AD_SELECTORS = [
  "[id^='google_ads']", "[id*='-ad-']", "[class*='adsbygoogle']", "ins.adsbygoogle", "iframe[src*='doubleclick']",
  "iframe[src*='googlesyndication']", "[class*='ad-banner']", "[class*='advert']", "[aria-label='Publicidade']",
  "[aria-label='Advertisement']", "[class*='cookie-banner']", "[id*='cookie-banner']", "[class*='newsletter-popup']",
  "[class*='sticky-ad']", "[data-ad]", "[data-ad-slot]",
];

export const DEFAULT_DESIGN = { theme: "nenhum", fontScale: 100, maxWidth: 0, hideAds: false };

export function normalizeDesign(prefs = {}) {
  const theme = Object.hasOwn(THEMES, prefs.theme) ? prefs.theme : "nenhum";
  const fontScale = Math.min(200, Math.max(70, Math.round(Number(prefs.fontScale) || 100)));
  const mw = Math.round(Number(prefs.maxWidth) || 0);
  const maxWidth = mw <= 0 ? 0 : Math.min(2000, Math.max(480, mw));
  return { theme, fontScale, maxWidth, hideAds: prefs.hideAds === true };
}

export function isDefaultDesign(prefs) {
  const p = normalizeDesign(prefs);
  return p.theme === "nenhum" && p.fontScale === 100 && p.maxWidth === 0 && !p.hideAds;
}

/** Gera o CSS (só CSS, nada de script) para o design escolhido. */
export function buildThemeCss(prefs) {
  const p = normalizeDesign(prefs);
  const parts = [];
  if (THEMES[p.theme].css) parts.push(THEMES[p.theme].css);
  if (p.fontScale !== 100) parts.push(`body{zoom:${p.fontScale / 100}!important}`);
  if (p.maxWidth) parts.push(`body{max-width:${p.maxWidth}px!important;margin-left:auto!important;margin-right:auto!important}`);
  if (p.hideAds) parts.push(`${AD_SELECTORS.join(",")}{display:none!important}`);
  return parts.join("\n");
}

/** Chave por site (origem http/https). Retorna null para páginas internas. */
export function siteKey(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function canScriptUrl(url = "") {
  if (!/^(https?|file):/i.test(url)) return false;
  return !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons|addons\.mozilla\.org)/i.test(url);
}

/* ---------- Modo dev ---------- */

const SENSITIVE_NAME_RE = /(token|auth|sess|secret|senha|pass|jwt|key|sid|csrf|xsrf|bearer|cred)/i;

/** Só nomes de cookies (nunca valores); marca os que parecem sensíveis. */
export function summarizeCookies(cookieString = "") {
  const names = String(cookieString).split(";").map((c) => c.split("=")[0].trim()).filter(Boolean);
  const unique = uniq(names);
  return {
    total: unique.length,
    nomes: unique.map((n) => (SENSITIVE_NAME_RE.test(n) ? `${n} (sensível)` : n)),
    observacao: "Cookies HttpOnly não aparecem para scripts da página.",
  };
}

export function summarizeStorageEntries(entries = []) {
  let bytes = 0;
  const nomes = [];
  for (const [key, size] of entries) {
    nomes.push(key);
    bytes += (String(key).length + Number(size || 0)) * 2;
  }
  return { total: nomes.length, nomes: nomes.slice(0, 100), tamanhoAproxKB: Math.round(bytes / 102.4) / 10 };
}

export function extensionsPageUrl(userAgent = "") {
  if (/Edg\//.test(userAgent)) return "edge://extensions";
  if (/Firefox\//.test(userAgent)) return "about:addons";
  return "chrome://extensions";
}

export const DEVTOOLS_EXTENSIONS = [
  { nome: "React Developer Tools", url: "https://chromewebstore.google.com/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi" },
  { nome: "Vue.js devtools", url: "https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd" },
  { nome: "Redux DevTools", url: "https://chromewebstore.google.com/detail/redux-devtools/lmhkpmbekcpmknklioeibfkpmmfibljd" },
  { nome: "Lighthouse", url: "https://chromewebstore.google.com/detail/lighthouse/blipmdconlkpinefehnmjammfjpmpbjk" },
  { nome: "Wappalyzer", url: "https://chromewebstore.google.com/detail/wappalyzer-technology-pro/gppongmhjkpfnbhagpmjfkannfbllamg" },
  { nome: "JSON Formatter (visualizador de JSON)", url: "https://chromewebstore.google.com/detail/json-formatter/bcjindcccaagfpapjjmafapmmgkkhgoa" },
];

/* ---------- Apps ---------- */

export const APP_LINKS = {
  notebooklm: "https://notebooklm.google.com/",
  onenoteWeb: "https://www.onenote.com/notebooks",
};

export function formatNoteText(title, url, selection = "") {
  const t = String(title || "(sem título)").trim();
  const lines = [`📄 ${t}`, String(url || "").trim()];
  if (selection && String(selection).trim()) lines.push("", `> ${String(selection).trim().slice(0, 2000)}`);
  lines.push("", `Salvo pelo Mestre do PC em ${new Date().toLocaleString("pt-BR")}`);
  return lines.join("\n");
}

export function safeFileName(base, ext) {
  const clean = String(base || "pagina").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "pagina";
  return `${clean}.${ext}`;
}

export const TOOL_VIEWS = ["extrair", "json", "design", "dev", "devtools", "apps", "admin"];

/* ---------- Administração (operações do launcher) ---------- */

/**
 * Catálogo fixo das operações de administração. Cada id existe em
 * v10/allowed-operations.json (categoria "Administração"); a extensão nunca
 * manda comando livre. classe: leitura | execucao | destrutiva.
 * confirmacao: nenhuma | simples | dupla (dupla = digitar a palavra).
 */
export const ADMIN_OPS = [
  { id: "admin_reiniciar_mestre", grupo: "Mestre", titulo: "Reiniciar o Mestre do PC", classe: "execucao", elevado: true, confirmacao: "simples",
    descricao: "Abre uma janela de administrador (UAC) que encerra o launcher travado na porta 7777, sobe de novo pela tarefa MestreDoPC_Admin_Launcher e confere o /ping." },
  { id: "admin_criar_ponto_restauracao", grupo: "Sistema", titulo: "Criar ponto de restauração", classe: "execucao", elevado: true, confirmacao: "simples",
    descricao: "Abre uma janela de administrador (UAC) e cria um ponto de restauração do Windows no C:. Não apaga nada." },
  { id: "admin_turbo_admin", grupo: "Sistema", titulo: "Turbo admin (Temp do Windows, DISM, Windows Update, retrim)", classe: "destrutiva", elevado: true, confirmacao: "simples",
    descricao: "Janela de administrador (UAC): cria ponto de restauração, apaga arquivos de C:\\Windows\\Temp com mais de 24 h, limpa componentes do Windows Update (DISM) e o cache de download do Windows Update, e faz retrim do SSD C:. Não mexe na Lixeira nem em arquivos pessoais." },
  { id: "admin_sfc_verificar", grupo: "Reparo do Windows", titulo: "SFC: só verificar", classe: "leitura", elevado: true, confirmacao: "simples",
    descricao: "Janela de administrador (UAC) com sfc /verifyonly: procura arquivos do sistema corrompidos sem consertar." },
  { id: "admin_sfc_reparar", grupo: "Reparo do Windows", titulo: "SFC: verificar e reparar", classe: "execucao", elevado: true, confirmacao: "simples",
    descricao: "Janela de administrador (UAC) com sfc /scannow: verifica e substitui arquivos do sistema corrompidos. Leva de 10 a 30 min." },
  { id: "admin_dism_verificar", grupo: "Reparo do Windows", titulo: "DISM: só verificar a imagem", classe: "leitura", elevado: true, confirmacao: "simples",
    descricao: "Janela de administrador (UAC) com DISM /CheckHealth e /ScanHealth: verifica a imagem do Windows sem consertar." },
  { id: "admin_dism_reparar", grupo: "Reparo do Windows", titulo: "DISM: reparar a imagem (RestoreHealth)", classe: "execucao", elevado: true, confirmacao: "simples",
    descricao: "Janela de administrador (UAC) com DISM /Online /Cleanup-Image /RestoreHealth: baixa e repõe componentes do Windows. Precisa de internet." },
  { id: "admin_winget_listar", grupo: "Atualizações", titulo: "Listar atualizações (winget)", classe: "leitura", elevado: false, confirmacao: "nenhuma",
    descricao: "Mostra os apps com versão nova no winget. Não instala nada." },
  { id: "admin_winget_atualizar_tudo", grupo: "Atualizações", titulo: "Atualizar todos os apps (winget)", classe: "execucao", elevado: true, confirmacao: "simples",
    descricao: "Janela de administrador (UAC) com winget upgrade --all. Pode fechar e reabrir apps que estiverem sendo atualizados." },
  { id: "admin_reiniciar_ollama", grupo: "Serviços", titulo: "Reiniciar o Ollama", classe: "execucao", elevado: false, confirmacao: "simples",
    descricao: "Fecha o Ollama e abre de novo como usuário normal. Descarrega os modelos da memória." },
  { id: "admin_reiniciar_spooler", grupo: "Serviços", titulo: "Reiniciar o spooler de impressão", classe: "execucao", elevado: true, confirmacao: "simples",
    descricao: "Janela de administrador (UAC) que reinicia o serviço Spooler. Trabalhos de impressão presos podem ser perdidos." },
  { id: "admin_flush_dns", grupo: "Serviços", titulo: "Limpar cache DNS", classe: "execucao", elevado: false, confirmacao: "simples",
    descricao: "Roda ipconfig /flushdns. A internet não cai." },
  { id: "admin_renovar_rede", grupo: "Serviços", titulo: "Rede: limpar DNS e renovar IP", classe: "execucao", elevado: true, confirmacao: "simples",
    descricao: "Janela de administrador (UAC) com ipconfig /flushdns, /release e /renew. A internet cai por alguns segundos." },
  { id: "admin_abrir_gerenciador_tarefas", grupo: "Ferramentas do Windows", titulo: "Abrir Gerenciador de Tarefas", classe: "leitura", elevado: false, confirmacao: "nenhuma",
    descricao: "Abre o Gerenciador de Tarefas." },
  { id: "admin_abrir_servicos", grupo: "Ferramentas do Windows", titulo: "Abrir Serviços", classe: "leitura", elevado: false, confirmacao: "nenhuma",
    descricao: "Abre services.msc." },
  { id: "admin_abrir_eventos", grupo: "Ferramentas do Windows", titulo: "Abrir Visualizador de Eventos", classe: "leitura", elevado: false, confirmacao: "nenhuma",
    descricao: "Abre eventvwr.msc." },
  { id: "admin_abrir_disco", grupo: "Ferramentas do Windows", titulo: "Abrir Gerenciamento de Disco", classe: "leitura", elevado: false, confirmacao: "nenhuma",
    descricao: "Abre diskmgmt.msc (só abre; nada é formatado)." },
  { id: "admin_apps_inicializacao", grupo: "Segurança", titulo: "Ver apps de inicialização", classe: "leitura", elevado: false, confirmacao: "nenhuma",
    descricao: "Lista o que abre com o Windows (Run do usuário e da máquina, pasta Inicializar e itens desativados). Não muda nada." },
  { id: "admin_defender_status", grupo: "Segurança", titulo: "Status do Microsoft Defender", classe: "leitura", elevado: false, confirmacao: "nenhuma",
    descricao: "Mostra proteção em tempo real, assinaturas e última verificação." },
  { id: "admin_defender_verificacao_rapida", grupo: "Segurança", titulo: "Defender: verificação rápida", classe: "execucao", elevado: true, confirmacao: "simples",
    descricao: "Janela de administrador (UAC) com Start-MpScan -ScanType QuickScan. Leva alguns minutos." },
  { id: "admin_reiniciar_pc", grupo: "Energia", titulo: "Reiniciar o PC (em 60 s)", classe: "destrutiva", elevado: false, confirmacao: "dupla", palavra: "REINICIAR",
    descricao: "Agenda o reinício em 60 segundos (shutdown /r /t 60). Salve seus trabalhos. Dá para cancelar com 'Cancelar reinício/desligamento'." },
  { id: "admin_desligar_pc", grupo: "Energia", titulo: "Desligar o PC (em 60 s)", classe: "destrutiva", elevado: false, confirmacao: "dupla", palavra: "DESLIGAR",
    descricao: "Agenda o desligamento em 60 segundos (shutdown /s /t 60). Salve seus trabalhos. Dá para cancelar com 'Cancelar reinício/desligamento'." },
  { id: "admin_cancelar_desligamento", grupo: "Energia", titulo: "Cancelar reinício/desligamento", classe: "execucao", elevado: false, confirmacao: "nenhuma",
    descricao: "Roda shutdown /a e cancela um reinício ou desligamento agendado." },
];

export const ADMIN_CLASS_LABEL = { leitura: "Leitura", execucao: "Execução", destrutiva: "Destrutiva" };

export function findAdminOp(id) {
  return ADMIN_OPS.find((op) => op.id === id) || null;
}

/** true quando a operação precisa de confirmação (espelha destructive no catálogo/MCP). */
export function adminNeedsConfirmation(op) {
  return Boolean(op) && op.confirmacao !== "nenhuma";
}

/**
 * Valida a confirmação digitada no painel. Simples: marcar a caixa.
 * Dupla: caixa marcada + palavra exata (ex.: REINICIAR).
 */
export function adminConfirmationOk(op, { checked = false, typed = "" } = {}) {
  if (!op) return false;
  if (op.confirmacao === "nenhuma") return true;
  if (!checked) return false;
  if (op.confirmacao === "dupla") return String(typed).trim().toUpperCase() === op.palavra;
  return true;
}
