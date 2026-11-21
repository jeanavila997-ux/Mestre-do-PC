import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_OPS, DEVTOOLS_EXTENSIONS, EXTRACT_TYPES, THEMES, adminConfirmationOk, adminNeedsConfirmation,
  buildPageSummary, buildThemeCss, canScriptUrl, extensionsPageUrl, findEmails, findPhones, findPrices,
  formatNoteText, isDefaultDesign, normalizeDesign, rowsForType, rowsToObjects, safeFileName, searchLines,
  siteKey, summarizeCookies, summarizeStorageEntries, summaryPrompt, toCsv, tryParseJson,
} from "./tools-core.js";

const RAW = {
  title: "Loja Avila",
  url: "https://loja.example.com/produtos",
  lang: "pt-BR",
  meta: { description: "Ração" },
  text: "Fale com vendas@fazendaavila.com.br ou (68) 99999-1234. Ração 25kg R$ 189,90 e sal R$ 1.250,00. Não é telefone: 2026.",
  tables: [[["Produto", "Preço"], ["Ração", "R$ 189,90"]]],
  lists: [["um", "dois"]],
  links: [{ text: "Site", href: "https://example.com/" }],
  mailtos: ["contato@example.com"],
  tels: ["+55 68 3224-0000"],
  headings: [{ level: 1, text: "Produtos" }],
  images: 3,
};

test("extração: e-mails, telefones e preços", () => {
  assert.deepEqual(findEmails(RAW.text), ["vendas@fazendaavila.com.br"]);
  assert.deepEqual(findPhones(RAW.text), ["(68) 99999-1234"]);
  assert.deepEqual(findPrices(RAW.text), ["R$ 189,90", "R$ 1.250,00"]);
  assert.deepEqual(findEmails(""), []);
});

test("extração: rowsForType cobre todos os tipos", () => {
  for (const { id } of EXTRACT_TYPES) {
    const r = rowsForType(id, RAW);
    assert.ok(Array.isArray(r.headers) && r.headers.length > 0, id);
    assert.ok(r.rows.length > 0, `sem linhas para ${id}`);
  }
  assert.deepEqual(rowsForType("emails", RAW).rows, [["contato@example.com"], ["vendas@fazendaavila.com.br"]]);
  assert.deepEqual(rowsForType("tabelas", RAW).rows[1], ["Tabela 1", "Ração", "R$ 189,90"]);
  assert.throws(() => rowsForType("senhas", RAW), /inválido/);
  assert.deepEqual(rowsToObjects({ headers: ["a", "b"], rows: [["1"]] }), [{ a: "1", b: "" }]);
});

test("CSV: separador ;, aspas e proteção contra fórmula", () => {
  const csv = toCsv([["nome", "obs"], ["Ração; 25kg", 'diz "oi"'], ["=HYPERLINK(1)", "+1"]]);
  assert.equal(csv, 'nome;obs\r\n"Ração; 25kg";"diz ""oi"""\r\n\'=HYPERLINK(1);\'+1');
  assert.equal(toCsv([["a", null, 3]], "\t"), "a\t\t3");
});

test("JSON: parse, busca por linha e resumo da página", () => {
  assert.equal(tryParseJson('{"a":1}').ok, true);
  assert.equal(tryParseJson("<html>").ok, false);
  assert.equal(tryParseJson("{oops}").ok, false);
  assert.deepEqual(searchLines('{\n  "nome": "Jean",\n  "x": 1\n}', "JEAN"), [2]);
  assert.deepEqual(searchLines("abc", ""), []);
  const s = buildPageSummary({ ...RAW, generatedAt: "2026-11-21T06:00:00.000Z" });
  assert.equal(s.titulo, "Loja Avila");
  assert.equal(s.contagem.links, 1);
  assert.equal(s.contagem.imagens, 3);
  assert.ok(s.extraidos.emails.includes("vendas@fazendaavila.com.br"));
  assert.deepEqual(s.extraidos.precos, ["R$ 189,90", "R$ 1.250,00"]);
  assert.match(summaryPrompt(s), /pt-BR/);
  assert.ok(summaryPrompt(s, 50).length < 400);
});

test("design: temas, normalização e CSS só com regras", () => {
  for (const id of ["nenhum", "escuro", "jarvis", "leitura", "contraste"]) assert.ok(THEMES[id], id);
  assert.deepEqual(normalizeDesign({ theme: "hack", fontScale: 999, maxWidth: 10, hideAds: "sim" }), { theme: "nenhum", fontScale: 200, maxWidth: 480, hideAds: false });
  assert.equal(isDefaultDesign({}), true);
  assert.equal(buildThemeCss({}), "");
  const css = buildThemeCss({ theme: "jarvis", fontScale: 120, maxWidth: 800, hideAds: true });
  assert.match(css, /#00e5ff/);
  assert.match(css, /zoom:1\.2/);
  assert.match(css, /max-width:800px/);
  assert.match(css, /adsbygoogle/);
  assert.doesNotMatch(css, /<script|javascript:|expression\(/i);
});

test("design: chave por site e páginas que não aceitam script", () => {
  assert.equal(siteKey("https://a.com/x?y=1"), "https://a.com");
  assert.equal(siteKey("chrome://extensions"), null);
  assert.equal(siteKey("lixo"), null);
  assert.equal(canScriptUrl("https://site.com"), true);
  assert.equal(canScriptUrl("edge://settings"), false);
  assert.equal(canScriptUrl("https://chromewebstore.google.com/detail/x"), false);
});

test("modo dev: cookies só com nomes e storage sem valores", () => {
  const c = summarizeCookies("sessionid=SEGREDO; tema=escuro; _ga=GA1.2; tema=claro");
  assert.equal(c.total, 3);
  assert.deepEqual(c.nomes, ["sessionid (sensível)", "tema", "_ga"]);
  assert.doesNotMatch(JSON.stringify(c), /SEGREDO|escuro|GA1/);
  const st = summarizeStorageEntries([["token", 100], ["x", 0]]);
  assert.equal(st.total, 2);
  assert.deepEqual(st.nomes, ["token", "x"]);
  assert.equal(extensionsPageUrl("Mozilla/5.0 Chrome/140 Edg/140"), "edge://extensions");
  assert.equal(extensionsPageUrl("Mozilla/5.0 Chrome/140"), "chrome://extensions");
});

test("DevTools: links da Chrome Web Store", () => {
  assert.equal(DEVTOOLS_EXTENSIONS.length, 6);
  for (const e of DEVTOOLS_EXTENSIONS) assert.match(e.url, /^https:\/\/chromewebstore\.google\.com\/detail\/[a-z0-9-]+\/[a-p]{32}$/);
});

test("apps: nota formatada e nome de arquivo seguro", () => {
  const n = formatNoteText("Título", "https://x.com", "trecho");
  assert.match(n, /^📄 Título\nhttps:\/\/x\.com\n\n> trecho/);
  assert.equal(safeFileName("Ração: 25kg / R$", "csv"), "Racao-25kg-R.csv");
  assert.equal(safeFileName("", "json"), "pagina.json");
});

test("administração: catálogo fixo, classes e confirmações", () => {
  const ids = new Set();
  for (const op of ADMIN_OPS) {
    assert.match(op.id, /^admin_[a-z_]+$/);
    assert.ok(!ids.has(op.id), "id repetido " + op.id);
    ids.add(op.id);
    assert.ok(["leitura", "execucao", "destrutiva"].includes(op.classe), op.id);
    assert.ok(["nenhuma", "simples", "dupla"].includes(op.confirmacao), op.id);
    assert.ok(op.descricao.length > 15, op.id);
    if (op.elevado) assert.notEqual(op.confirmacao, "nenhuma", `${op.id} eleva e precisa de confirmação`);
    if (op.classe === "destrutiva") assert.notEqual(op.confirmacao, "nenhuma", op.id);
  }
  for (const id of ["admin_reiniciar_pc", "admin_desligar_pc"]) {
    const op = ADMIN_OPS.find((o) => o.id === id);
    assert.equal(op.confirmacao, "dupla");
    assert.equal(adminConfirmationOk(op, { checked: true, typed: "" }), false);
    assert.equal(adminConfirmationOk(op, { checked: false, typed: op.palavra }), false);
    assert.equal(adminConfirmationOk(op, { checked: true, typed: op.palavra.toLowerCase() }), true);
  }
  const simples = ADMIN_OPS.find((o) => o.id === "admin_sfc_reparar");
  assert.equal(adminNeedsConfirmation(simples), true);
  assert.equal(adminConfirmationOk(simples, {}), false);
  assert.equal(adminConfirmationOk(simples, { checked: true }), true);
  const leitura = ADMIN_OPS.find((o) => o.id === "admin_defender_status");
  assert.equal(adminConfirmationOk(leitura, {}), true);
  assert.equal(adminConfirmationOk(null, { checked: true }), false);
  const texto = JSON.stringify(ADMIN_OPS);
  assert.doesNotMatch(texto, /Clear-RecycleBin|Lixeira será|DisableRealtimeMonitoring|EnableLUA|advfirewall/i);
});
