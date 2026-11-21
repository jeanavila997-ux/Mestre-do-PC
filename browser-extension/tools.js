/**
 * Painel de Ferramentas da extensão Mestre do PC.
 * Abre numa janela própria e age na aba que estava ativa (activeTab).
 */
import {
  ADMIN_CLASS_LABEL, ADMIN_OPS, APP_LINKS, DEFAULT_DESIGN, DEVTOOLS_EXTENSIONS, EXTRACT_TYPES, THEMES,
  adminConfirmationOk, adminNeedsConfirmation, buildPageSummary, canScriptUrl, extensionsPageUrl, findAdminOp,
  formatJson, formatNoteText, normalizeDesign, rowsForType, rowsToObjects, safeFileName, searchLines,
  summarizeCookies, summarizeStorageEntries, summaryPrompt, toCsv, tryParseJson, TOOL_VIEWS,
} from "./tools-core.js";
import { clearSiteData, collectDevInfo, extractPageRaw, installDevHook, readNoteContext } from "./page-scripts.js";
import {
  AUTO_DESIGN_ORIGINS, applyDesignToTab, getDesignFor, hasAutoDesignPermission, saveDesignFor,
} from "./tools-actions.js";
import { askMestreAI, launcherOnline, runOperation, waitForJob } from "./mestre-api.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const state = { tab: null, raw: null, extracted: null, jsonText: "", jsonSummary: null, adminOp: null };

function show(msg, type = "success") {
  const el = $("msg");
  el.textContent = msg;
  el.className = "msg show " + type;
  clearTimeout(show.t);
  show.t = setTimeout(() => { el.className = "msg"; }, 6000);
}

async function resolveTab() {
  const id = Number(params.get("tabId"));
  if (Number.isInteger(id) && id >= 0) {
    try { return await chrome.tabs.get(id); } catch { /* aba fechada */ }
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: "normal" });
  return tab || null;
}

async function inject(func, { world = "ISOLATED", args = [] } = {}) {
  if (!state.tab?.id) throw new Error("Nenhuma aba alvo. Abra o painel pelo popup ou pelo botão direito na página.");
  if (!canScriptUrl(state.tab.url || "")) throw new Error("O navegador não deixa extensões lerem esta página (interna ou loja).");
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: state.tab.id }, func, args, world });
    return r?.result;
  } catch (e) {
    throw new Error("Sem acesso à página. Abra o popup da extensão nessa aba e tente de novo. (" + e.message + ")");
  }
}

async function copy(text) {
  await navigator.clipboard.writeText(text);
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

/* ---------- navegação ---------- */

function selectView(view) {
  if (!TOOL_VIEWS.includes(view)) view = "extrair";
  for (const btn of document.querySelectorAll("nav button")) btn.setAttribute("aria-selected", String(btn.dataset.view === view));
  for (const v of TOOL_VIEWS) $("view-" + v).hidden = v !== view;
  if (view === "dev") refreshDev().catch((e) => show(e.message, "error"));
  if (view === "design") loadDesign().catch(() => {});
}

/* ---------- extrair ---------- */

async function getRaw(force = false) {
  if (!state.raw || force) state.raw = await inject(extractPageRaw);
  return state.raw;
}

function renderTable({ headers, rows }) {
  const table = $("extractTable");
  table.replaceChildren();
  table.append(el("thead", {}, [el("tr", {}, headers.map((h) => el("th", { text: h })))]));
  const body = el("tbody");
  for (const row of rows.slice(0, 1000)) body.append(el("tr", {}, headers.map((_, i) => el("td", { text: row[i] ?? "" }))));
  table.append(body);
  $("extractCount").textContent = rows.length
    ? `${rows.length} item(ns)${rows.length > 1000 ? " (mostrando 1000; o arquivo leva todos)" : ""}.`
    : "Nada desse tipo nesta página.";
}

async function doExtract() {
  const raw = await getRaw(true);
  const type = $("extractType").value;
  state.extracted = { type, ...rowsForType(type, raw) };
  renderTable(state.extracted);
  for (const id of ["btnCopyTsv", "btnCsv", "btnJsonDl"]) $(id).disabled = state.extracted.rows.length === 0;
}

/* ---------- JSON ---------- */

function renderJson(text) {
  state.jsonText = text;
  const term = $("jsonSearch").value;
  const hits = new Set(searchLines(text, term));
  const pre = $("jsonOut");
  pre.replaceChildren();
  text.split("\n").forEach((line, i) => {
    pre.append(hits.has(i + 1) ? el("span", { class: "hit", text: line }) : document.createTextNode(line));
    pre.append("\n");
  });
  $("jsonHits").textContent = term ? `${hits.size} linha(s) com "${term}"` : "";
  $("btnJsonCopy").disabled = !text;
  $("btnJsonSave").disabled = !text;
  if (hits.size) pre.querySelector(".hit")?.scrollIntoView({ block: "center" });
}

async function doJsonView() {
  const raw = await getRaw(true);
  const looksJson = /json/i.test(raw.contentType) || /^\s*[[{]/.test(raw.text);
  const parsed = tryParseJson(raw.text);
  if (!parsed.ok) {
    renderJson("");
    show(looksJson ? "JSON inválido: " + parsed.error : "Esta página não é um JSON. Use 'Resumo em JSON da página'.", "error");
    return;
  }
  state.jsonSummary = null;
  $("btnJsonAI").disabled = true;
  renderJson(formatJson(parsed.value));
}

async function doJsonSummary() {
  const raw = await getRaw(true);
  state.jsonSummary = buildPageSummary(raw);
  renderJson(formatJson(state.jsonSummary));
  $("btnJsonAI").disabled = false;
}

/* ---------- design ---------- */

function readDesignForm() {
  return normalizeDesign({
    theme: $("designTheme").value,
    fontScale: $("designFont").value,
    maxWidth: $("designWidth").value,
    hideAds: $("designAds").checked,
  });
}

function fillDesignForm(prefs) {
  const p = normalizeDesign(prefs || DEFAULT_DESIGN);
  $("designTheme").value = p.theme;
  $("designFont").value = String(p.fontScale);
  $("designFontVal").textContent = p.fontScale + "%";
  $("designWidth").value = String(p.maxWidth);
  $("designAds").checked = p.hideAds;
}

async function loadDesign() {
  fillDesignForm(state.tab?.url ? await getDesignFor(state.tab.url) : null);
  $("designAuto").checked = await hasAutoDesignPermission();
}

/* ---------- modo dev ---------- */

function kv(title, obj) {
  const card = el("div", { class: "card" }, [el("h3", { text: title })]);
  const ul = el("ul", { class: "plain" });
  for (const [k, v] of Object.entries(obj)) ul.append(el("li", { text: `${k}: ${Array.isArray(v) ? v.join(", ") || "—" : v}` }));
  card.append(ul);
  return card;
}

async function refreshDev() {
  await inject(installDevHook, { world: "MAIN" });
  const info = await inject(collectDevInfo, { world: "MAIN" });
  const out = $("devOut");
  out.replaceChildren();
  out.append(kv("Frameworks detectados", { encontrados: info.frameworks.length ? info.frameworks : ["nenhum detectado"] }));
  out.append(kv("Tempo de carregamento", info.tempo));
  const cookies = summarizeCookies(info.cookieString);
  out.append(kv("Armazenamento (só nomes, sem valores)", {
    cookies: `${cookies.total}`,
    "nomes dos cookies": cookies.nomes,
    localStorage: `${summarizeStorageEntries(info.localStorage).total} chave(s), ~${summarizeStorageEntries(info.localStorage).tamanhoAproxKB} KB`,
    "chaves do localStorage": summarizeStorageEntries(info.localStorage).nomes,
    sessionStorage: `${summarizeStorageEntries(info.sessionStorage).total} chave(s)`,
    "service worker ativo": info.serviceWorker ? "sim" : "não",
    recursos: info.recursos,
  }));
  const errCard = el("div", { class: "card" }, [el("h3", { text: `Erros do console (${info.erros.length})` })]);
  if (!info.erros.length) errCard.append(el("p", { class: "hint", text: "Nenhum erro desde que o painel abriu. Use a página e clique em Atualizar." }));
  for (const e of info.erros) errCard.append(el("pre", { text: `[${e.kind}] ${new Date(e.at).toLocaleTimeString("pt-BR")} ${e.msg}` }));
  out.append(errCard);
  out.append(el("p", { class: "hint", text: cookies.observacao }));
}

/* ---------- DevTools ---------- */

function renderDevtoolsList() {
  const list = $("devtoolsList");
  for (const ext of DEVTOOLS_EXTENSIONS) {
    const b = el("button", { text: "📦 " + ext.nome });
    b.addEventListener("click", () => chrome.tabs.create({ url: ext.url }));
    list.append(b);
  }
}

async function focusTarget() {
  if (!state.tab) return;
  await chrome.windows.update(state.tab.windowId, { focused: true });
  await chrome.tabs.update(state.tab.id, { active: true });
}

/* ---------- administração ---------- */

function renderAdminList() {
  const list = $("adminList");
  const groups = [...new Set(ADMIN_OPS.map((o) => o.grupo))];
  for (const g of groups) {
    list.append(el("h3", { text: g }));
    const grid = el("div", { class: "grid" });
    for (const op of ADMIN_OPS.filter((o) => o.grupo === g)) {
      const b = el("button", { "data-op": op.id }, [op.titulo, el("span", { class: "badge " + op.classe, text: ADMIN_CLASS_LABEL[op.classe] })]);
      if (op.elevado) b.append(el("span", { class: "badge elevado", text: "UAC" }));
      b.addEventListener("click", () => selectAdmin(op.id));
      grid.append(b);
    }
    list.append(grid);
  }
}

function updateAdminRunButton() {
  const op = state.adminOp;
  $("btnAdminRun").disabled = !adminConfirmationOk(op, { checked: $("adminConfirm").checked, typed: $("adminTyped").value });
}

function selectAdmin(id, autorun = false) {
  const op = findAdminOp(id);
  if (!op) return;
  state.adminOp = op;
  $("adminDetail").hidden = false;
  $("adminTitle").textContent = op.titulo;
  const badges = $("adminBadges");
  badges.replaceChildren(el("span", { class: "badge " + op.classe, text: ADMIN_CLASS_LABEL[op.classe] }));
  if (op.elevado) badges.append(el("span", { class: "badge elevado", text: "Administrador (UAC)" }));
  if (op.confirmacao === "dupla") badges.append(el("span", { class: "badge destrutiva", text: "Confirmação dupla" }));
  $("adminDesc").textContent = op.descricao;
  $("adminConfirm").checked = false;
  $("adminTyped").value = "";
  $("adminConfirmBox").hidden = !adminNeedsConfirmation(op);
  $("adminWordBox").hidden = op.confirmacao !== "dupla";
  $("adminWord").textContent = op.palavra || "";
  $("btnAdminRun").className = op.classe === "destrutiva" ? "danger" : "primary";
  $("adminOut").hidden = true;
  updateAdminRunButton();
  $("adminDetail").scrollIntoView({ block: "nearest" });
  if (autorun && !adminNeedsConfirmation(op)) runAdmin();
}

async function runAdmin() {
  const op = state.adminOp;
  if (!adminConfirmationOk(op, { checked: $("adminConfirm").checked, typed: $("adminTyped").value })) {
    show("Confirme antes de executar.", "error");
    return;
  }
  if (op.confirmacao === "dupla" && !window.confirm(`Última confirmação: ${op.titulo}. Continuar?`)) return;
  const out = $("adminOut");
  out.hidden = false;
  out.textContent = "Enviando para o Mestre…";
  $("btnAdminRun").disabled = true;
  try {
    const job = await runOperation(op.id);
    out.textContent = `Aceito (job ${job.jobId}). Aguardando saída…`;
    const st = await waitForJob(job.jobId, {
      timeoutMs: 180000,
      onUpdate: (s) => { if (s.output) out.textContent = s.output; },
    });
    out.textContent = (st.output || "(sem saída)") + `\n\n[${st.state}${st.exitCode != null ? ", código " + st.exitCode : ""}]`;
  } catch (e) {
    out.textContent = op.id === "admin_reiniciar_mestre"
      ? "O Mestre está reiniciando (a conexão caiu, o que é esperado). Aguarde uns 20 s e clique em Atualizar no popup."
      : "Falha: " + e.message;
  } finally {
    $("adminConfirm").checked = false;
    $("adminTyped").value = "";
    updateAdminRunButton();
  }
}

/* ---------- ligações ---------- */

function on(id, fn) {
  $(id).addEventListener("click", async () => {
    try { await fn(); } catch (e) { show(e.message, "error"); }
  });
}

function wire() {
  for (const btn of document.querySelectorAll("nav button")) btn.addEventListener("click", () => selectView(btn.dataset.view));
  for (const t of EXTRACT_TYPES) $("extractType").append(el("option", { value: t.id, text: t.label }));
  for (const [id, t] of Object.entries(THEMES)) $("designTheme").append(el("option", { value: id, text: t.label }));

  on("btnExtract", doExtract);
  on("btnCopyTsv", async () => { await copy(toCsv([state.extracted.headers, ...state.extracted.rows], "\t")); show("Copiado (cole no Excel ou Sheets)."); });
  on("btnCsv", async () => download(safeFileName(`${state.raw?.title}-${state.extracted.type}`, "csv"), "\ufeff" + toCsv([state.extracted.headers, ...state.extracted.rows]), "text/csv;charset=utf-8"));
  on("btnJsonDl", async () => download(safeFileName(`${state.raw?.title}-${state.extracted.type}`, "json"), formatJson({ url: state.raw?.url, tipo: state.extracted.type, itens: rowsToObjects(state.extracted) }), "application/json"));

  on("btnJsonView", doJsonView);
  on("btnJsonSummary", doJsonSummary);
  $("jsonSearch").addEventListener("input", () => renderJson(state.jsonText));
  on("btnJsonCopy", async () => { await copy(state.jsonText); show("JSON copiado."); });
  on("btnJsonSave", async () => download(safeFileName(state.raw?.title || "pagina", "json"), state.jsonText, "application/json"));
  on("btnJsonAI", async () => {
    if (!state.jsonSummary) throw new Error("Gere o resumo em JSON primeiro.");
    $("btnJsonAI").disabled = true;
    try {
      show("Enviando para a IA do Mestre…");
      const answer = await askMestreAI(summaryPrompt(state.jsonSummary));
      renderJson(state.jsonText + "\n\n/* Resposta da IA do Mestre */\n" + answer);
      show("Resposta da IA adicionada no fim.");
    } finally { $("btnJsonAI").disabled = false; }
  });

  $("designFont").addEventListener("input", () => { $("designFontVal").textContent = $("designFont").value + "%"; });
  on("btnDesignApply", async () => {
    const prefs = readDesignForm();
    if (!canScriptUrl(state.tab?.url || "")) throw new Error("Esta página não aceita design.");
    await applyDesignToTab(state.tab.id, prefs);
    await saveDesignFor(state.tab.url, prefs);
    show("Design aplicado e salvo para este site.");
  });
  on("btnDesignReset", async () => {
    fillDesignForm(DEFAULT_DESIGN);
    if (canScriptUrl(state.tab?.url || "")) await applyDesignToTab(state.tab.id, null);
    if (state.tab?.url) await saveDesignFor(state.tab.url, DEFAULT_DESIGN);
    show("Design original restaurado.");
  });
  $("designAuto").addEventListener("change", async (e) => {
    try {
      if (e.target.checked) {
        const ok = await chrome.permissions.request({ origins: AUTO_DESIGN_ORIGINS });
        e.target.checked = ok;
        show(ok ? "O design salvo será reaplicado ao abrir cada site." : "Permissão negada; o design volta pelo popup.", ok ? "success" : "error");
      } else {
        await chrome.permissions.remove({ origins: AUTO_DESIGN_ORIGINS });
        show("Reaplicação automática desligada.");
      }
    } catch (err) { show(err.message, "error"); }
  });

  on("btnDevRefresh", refreshDev);
  on("btnHardReload", async () => { await chrome.tabs.reload(state.tab.id, { bypassCache: true }); show("Página recarregada sem cache. Clique em Atualizar painel depois que carregar."); });
  on("btnExtPage", async () => {
    const url = extensionsPageUrl(navigator.userAgent);
    try { await chrome.tabs.create({ url }); } catch { await copy(url); show(`Não deu para abrir direto. Copiei ${url}; cole na barra de endereço.`, "error"); }
  });
  $("clearConfirm").addEventListener("change", (e) => { $("btnClearSite").disabled = !e.target.checked; });
  on("btnClearSite", async () => {
    if (!$("clearConfirm").checked) return;
    const host = new URL(state.tab.url).host;
    if (!window.confirm(`Limpar os dados de ${host}? Você pode sair da conta nesse site.`)) return;
    const done = await inject(clearSiteData);
    $("clearConfirm").checked = false;
    $("btnClearSite").disabled = true;
    show(`Limpo em ${host}: ${done.join(", ") || "nada a limpar"}. Recarregue a página.`);
  });

  on("btnF12", async () => {
    if (!(await launcherOnline())) throw new Error("O Mestre não está no ar. Use F12 ou Ctrl+Shift+I na página.");
    await focusTarget();
    await runOperation("browser_enviar_f12");
    show("Pedido enviado. Se o DevTools não abrir, aperte F12 na página.");
  });

  on("btnNotebook", async () => chrome.tabs.create({ url: APP_LINKS.notebooklm }));
  on("btnNotebookCopy", async () => { await copy(state.tab?.url || ""); show("Link copiado. No NotebookLM: Adicionar fonte → Site → colar."); });
  on("btnOneNote", async () => {
    if (await launcherOnline()) {
      try { await runOperation("browser_abrir_onenote"); show("Pedi ao Mestre para abrir o OneNote."); return; } catch { /* sem token: cai na web */ }
    }
    await chrome.tabs.create({ url: APP_LINKS.onenoteWeb });
    show("OneNote aberto na web.");
  });
  on("btnOneNoteCopy", async () => {
    let ctx = { title: state.tab?.title, url: state.tab?.url, selection: "" };
    try { ctx = (await inject(readNoteContext)) || ctx; } catch { /* página interna */ }
    await copy(formatNoteText(ctx.title, ctx.url, ctx.selection));
    show("Nota copiada. Cole no OneNote (Ctrl+V).");
  });

  renderDevtoolsList();
  renderAdminList();
  $("adminConfirm").addEventListener("change", updateAdminRunButton);
  $("adminTyped").addEventListener("input", updateAdminRunButton);
  on("btnAdminRun", runAdmin);
}

async function init() {
  wire();
  state.tab = await resolveTab();
  $("target").textContent = state.tab ? `Página: ${state.tab.title || state.tab.url}` : "Nenhuma aba alvo";
  const view = params.get("view") || "extrair";
  selectView(view);
  if (view === "json" && state.tab) doJsonView().catch(() => {});
  const op = params.get("op");
  if (view === "admin" && op) selectAdmin(op, true);
}

document.addEventListener("DOMContentLoaded", () => { init().catch((e) => show(e.message, "error")); });
