// Tela Biblioteca > Personas do chat integrado e selo de sync.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { BUILTIN_PERSONAS } from "../../v10/chat-integrado/user-library-pure.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ler = (rel) => readFile(join(root, "v10", "chat-integrado", rel), "utf8");

test("editor de persona tem rótulos, campo grande e um botão principal", async () => {
  const html = await ler("chat-integrado.html");
  assert.match(html, /<label class="lib-label" for="personaName">/);
  assert.match(html, /<label class="lib-label" for="personaBody">/);
  assert.match(html, /<label class="lib-label" for="personaProfile">Modelo sugerido<\/label>/);
  assert.match(html, /id="personaBody" class="persona-body" rows="10"/);
  assert.match(html, /id="personaSave" class="lib-btn lib-btn-primary"/);
  assert.match(html, /id="personaCancel" class="lib-btn" hidden/);
  assert.doesNotMatch(html, /Sem perfil sugerido/);
});

test("ações secundárias ficam em Mais ações, com nome claro", async () => {
  const html = await ler("chat-integrado.html");
  const inicio = html.indexOf('<details class="lib-more">');
  const fim = html.indexOf("</details>", inicio);
  assert.ok(inicio > 0 && fim > inicio);
  const bloco = html.slice(inicio, fim);
  for (const id of ["personaMakeDefault", "personaUseDefault", "personaRestore"]) {
    assert.ok(bloco.includes(`id="${id}"`), id);
  }
  assert.doesNotMatch(html, /Definir selecionada como padrão/);
});

test("CSS dá altura ao editor e destaque ao botão principal", async () => {
  const css = await ler("styles.css");
  assert.match(css, /textarea\.persona-body \{[^}]*min-height: 220px/);
  assert.match(css, /\.lib-btn-primary \{[^}]*background: var\(--accent\)/);
  assert.match(css, /\.lib-more > summary \{/);
});

test("lista e seletor explicam o modelo sugerido; edição mostra o que está sendo editado", async () => {
  const js = await ler("user-library-ui.js");
  assert.match(js, /"Nenhum \(continua no modelo atual\)"/);
  assert.match(js, /`Modelo sugerido: \$\{item\.suggestedProfile\}`/);
  assert.match(js, /`Editando: \$\{nome\}`/);
  assert.match(js, /bind\("personaCancel", "click"/);
  assert.match(js, /bind\("personaBody", "input"/);
  assert.doesNotMatch(js, /Sem perfil sugerido|Sugere o perfil/);
});

test("personas de exemplo não mostram crases de markdown no campo", () => {
  for (const p of BUILTIN_PERSONAS) assert.doesNotMatch(p.body, /```/, p.name);
});

test("sem MySQL o selo diz 'Salvo neste PC' em vez de um contador de pendências", async () => {
  const js = await ler("chat-integrado.js");
  assert.match(js, /badge\.textContent = "Salvo neste PC"/);
  assert.doesNotMatch(js, /Sync: local/);
  assert.doesNotMatch(js, /pending`/);
});
