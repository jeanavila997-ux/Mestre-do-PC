// Tela inicial em 5 abas: barra de abas, regras de CSS e categoria → aba.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import vm from "node:vm";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ABAS = ["inicio", "comandos", "rede", "seguranca", "ia"];

async function html() {
  return readFile(join(root, "v10", "index.html"), "utf8");
}

async function funcoesDasAbas() {
  const s = await html();
  const ini = s.indexOf("// <abas>");
  const fim = s.indexOf("// </abas>");
  assert.ok(ini > 0 && fim > ini, "bloco <abas> não encontrado");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${s.slice(ini, fim)}\nthis.abaDaCategoria = abaDaCategoria; this.ABAS = ABAS;`, ctx);
  return ctx;
}

test("barra com as 5 abas e uma regra de CSS para cada", async () => {
  const s = await html();
  for (const aba of ABAS) {
    assert.match(s, new RegExp(`role="tab" id="aba-${aba}" data-aba-alvo="${aba}"`), `botão da aba ${aba}`);
    assert.ok(s.includes(`body[data-aba-ativa="${aba}"] [data-aba]:not([data-aba~="${aba}"])`), `CSS da aba ${aba}`);
  }
  assert.match(s, /role="tablist"/);
});

test("todo data-aba fixo do HTML usa abas que existem", async () => {
  const s = await html();
  const usados = [...s.matchAll(/ data-aba="([^"$]+)"/g)].flatMap((m) => m[1].split(/\s+/));
  assert.ok(usados.length > 0);
  for (const a of usados) assert.ok(ABAS.includes(a), `aba desconhecida: ${a}`);
});

test("saída do comando aparece em todas as abas; métricas só no Início", async () => {
  const s = await html();
  const saida = s.match(/<div id="outputPanel" class="output-panel" data-aba="([^"]+)">/);
  assert.ok(saida);
  assert.deepEqual(saida[1].split(" ").sort(), [...ABAS].sort());
  assert.match(s, /<div class="dashboard" id="dashboard" data-aba="inicio">/);
  assert.match(s, /<div id="redeHost" data-aba="rede"><\/div>/);
});

test("categorias do catálogo caem na aba certa", async () => {
  const { abaDaCategoria, ABAS: abasJs } = await funcoesDasAbas();
  assert.deepEqual([...abasJs], ABAS);
  const casos = {
    Rede: "rede",
    Velocidade: "rede",
    "Segurança": "seguranca",
    "Blue Team": "seguranca",
    Defender: "seguranca",
    Privacidade: "seguranca",
    "Agentes CLI": "ia",
    MODELOS: "ia",
    Ollama: "ia",
    Python: "ia",
    Limpeza: "comandos",
    "Administração": "comandos",
    Outros: "comandos",
  };
  for (const [label, aba] of Object.entries(casos)) assert.equal(abaDaCategoria({ id: "x", label }), aba, label);
  for (const id of ["cat-web", "cat-computer-use", "cat-prompts", "cat-repos-estrela"]) {
    assert.equal(abaDaCategoria({ id, label: "qualquer" }), "ia", id);
  }
  // Toda categoria real do catálogo vai para uma aba válida.
  const cat = JSON.parse(await readFile(join(root, "v10", "allowed-operations.json"), "utf8"));
  for (const o of [...cat.operations, ...cat.templates]) {
    assert.ok(ABAS.includes(abaDaCategoria({ id: "x", label: o.category || "Outros" })));
  }
});

test("busca mostra categorias de todas as abas e o painel de rede vai para a aba Rede", async () => {
  const s = await html();
  assert.match(s, /body\[data-aba-ativa="busca"\] \[data-aba\]:not\(\.category\)/);
  assert.match(s, /if \(term\) entrarNaBusca\(\); else sairDaBusca\(\);/);
  const rede = await readFile(join(root, "v10", "rede-dashboard.js"), "utf8");
  assert.match(rede, /getElementById\('redeHost'\) \|\| document\.getElementById\('dashboard'\)/);
});
