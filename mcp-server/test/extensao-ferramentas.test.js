// Extensão v1.2.0: operações do launcher usadas pelas Ferramentas (F12 e OneNote).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));

async function catalog() {
  return JSON.parse(await readFile(join(root, "v10", "allowed-operations.json"), "utf8"));
}

test("catálogo tem browser_enviar_f12 e browser_abrir_onenote, não destrutivos", async () => {
  const byId = new Map((await catalog()).operations.map((op) => [op.id, op]));
  for (const [id, action] of [["browser_enviar_f12", "enviar-f12"], ["browser_abrir_onenote", "abrir-onenote"]]) {
    const op = byId.get(id);
    assert.ok(op, `faltando ${id}`);
    assert.equal(op.category, "Navegador");
    assert.equal(op.destructive, false);
    assert.match(op.command, new RegExp(`browser-devtools\\.ps1'\\) -Action ${action}$`));
  }
});

test("browser-devtools.ps1 aceita as ações novas e só manda F12 para navegador", async () => {
  const s = await readFile(join(root, "scripts", "browser-devtools.ps1"), "utf8");
  assert.match(s, /'enviar-f12'/);
  assert.match(s, /'abrir-onenote'/);
  assert.match(s, /GetForegroundWindow/);
  assert.match(s, /-notin @\('msedge', 'chrome', 'firefox'/);
  assert.match(s, /SendKeys\('\{F12\}'\)/);
  assert.match(s, /https:\/\/www\.onenote\.com\/notebooks/);
});

test("manifestos da extensão em 1.2.0, sem content_scripts e com host amplo só opcional", async () => {
  const pkg = JSON.parse(await readFile(join(root, "browser-extension", "package.json"), "utf8"));
  for (const name of ["manifest.json", "manifest-firefox.json"]) {
    const m = JSON.parse(await readFile(join(root, "browser-extension", name), "utf8"));
    assert.equal(m.version, "1.2.0");
    assert.equal(m.version, pkg.version);
    assert.equal(m.content_scripts, undefined);
    assert.deepEqual(m.host_permissions, ["http://127.0.0.1:7777/*"]);
    assert.ok(m.optional_host_permissions.includes("https://*/*"));
    assert.ok(m.permissions.includes("scripting") && m.permissions.includes("activeTab"));
  }
});

test("ids de operação usados pela extensão existem no catálogo", async () => {
  const c = await catalog();
  const ids = new Set([...c.operations.map((o) => o.id), ...c.templates.map((t) => t.id)]);
  const tools = await readFile(join(root, "browser-extension", "tools.js"), "utf8");
  const used = [...tools.matchAll(/runOperation\("([a-z0-9_]+)"\)/g)].map((m) => m[1]);
  assert.ok(used.length >= 2);
  for (const id of used) assert.ok(ids.has(id), `extensão chama ${id}, que não está no catálogo`);
});
