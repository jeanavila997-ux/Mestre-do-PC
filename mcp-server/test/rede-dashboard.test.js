// Painel de rede: classificação de saúde e classe CSS do selo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import vm from "node:vm";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ARQUIVO = join(root, "v10", "rede-dashboard.js");

async function carregarPainel() {
  const codigo = await readFile(ARQUIVO, "utf8");
  const ctx = { window: {}, document: { addEventListener() {} }, console, setTimeout, localStorage: undefined };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx, { filename: "rede-dashboard.js" });
  return ctx.window.RedeDashboard;
}

const medida = (extra) => ({ pgw: 3, pex: 40, perda: 0, dnsOk: true, httpsOk: true, ...extra });

test("sem nenhum dado medido o selo é SEM DADOS, não CRÍTICO", async () => {
  const p = await carregarPainel();
  assert.equal(p.classificar({ pgw: null, pex: null, perda: null, dnsOk: null, httpsOk: null }), "SEM DADOS");
  // Caso do print: perda não medida, latências vazias, DNS/HTTPS sem resposta.
  assert.equal(p.classificar({ pgw: null, pex: null, perda: null, dnsOk: null, httpsOk: true }), "SEM DADOS");
});

test("falha medida continua CRÍTICO", async () => {
  const p = await carregarPainel();
  assert.equal(p.classificar({ pgw: null, pex: null, perda: 100, dnsOk: null, httpsOk: null }), "CRÍTICO");
  assert.equal(p.classificar(medida({ dnsOk: false, httpsOk: false })), "CRÍTICO");
});

test("rede boa é SAUDÁVEL e latência 0 do roteador conta como medida", async () => {
  const p = await carregarPainel();
  assert.equal(p.classificar(medida()), "SAUDÁVEL");
  assert.equal(p.classificar(medida({ pgw: 0 })), "SAUDÁVEL");
});

test("sinais de problema viram ATENÇÃO", async () => {
  const p = await carregarPainel();
  assert.equal(p.classificar(medida({ pex: 350 })), "ATENÇÃO");
  assert.equal(p.classificar(medida({ perda: 25 })), "ATENÇÃO");
  assert.equal(p.classificar(medida({ dnsOk: false })), "ATENÇÃO");
  // Perda 0% mas sem latência lida: não confirma que está saudável.
  assert.equal(p.classificar({ pgw: null, pex: null, perda: 0, dnsOk: true, httpsOk: true }), "ATENÇÃO");
});

test("classe do selo sai sem acento e casa com o CSS", async () => {
  const p = await carregarPainel();
  const codigo = await readFile(ARQUIVO, "utf8");
  for (const [saude, classe] of [["CRÍTICO", "critico"], ["ATENÇÃO", "atencao"], ["SAUDÁVEL", "saudavel"], ["SEM DADOS", "sem-dados"]]) {
    assert.equal(p.classeSaude(saude), classe);
    assert.ok(codigo.includes(`.rd-badge.${classe} {`), `CSS sem .rd-badge.${classe}`);
  }
  assert.doesNotMatch(codigo, /saude\.toLowerCase\(\)/);
});

test("histórico não mostra undefined% quando não há sinal", async () => {
  const codigo = await readFile(ARQUIVO, "utf8");
  assert.doesNotMatch(codigo, /h\.sinal \+ '%'/);
});
