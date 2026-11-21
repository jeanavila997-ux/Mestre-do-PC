/**
 * Contrato das operações OneDrive na whitelist do Mestre do PC.
 * Comandos fixos: o launcher só chama scripts/onedrive.ps1 com -Action conhecido.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { clearOperationRegistryCache, loadOperationRegistry } from "../../v10/operation-registry.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const OPS = join(root, "v10", "allowed-operations.json");
const SCRIPT = join(root, "scripts", "onedrive.ps1");

const ACOES = [
  ["onedrive_status", "status", false],
  ["onedrive_abrir", "abrir", false],
  ["onedrive_config", "config", false],
  ["onedrive_pasta", "pasta", false],
  ["onedrive_web", "web", false],
  ["onedrive_armazenamento", "armazenamento", false],
  ["onedrive_reiniciar", "reiniciar", true],
];

async function catalogo() {
  return JSON.parse(await readFile(OPS, "utf8"));
}

test("catálogo: sete ações OneDrive, só reiniciar é destrutiva", async () => {
  const data = await catalogo();
  for (const [id, action, destructive] of ACOES) {
    const op = data.operations.find((item) => item.id === id);
    assert.ok(op, `${id} ausente`);
    assert.equal(op.category, "OneDrive");
    assert.equal(op.destructive, destructive);
    assert.match(op.command, /scripts\\onedrive\.ps1/);
    assert.match(op.command, new RegExp(`-Action ${action}\\b`));
    assert.doesNotMatch(op.command, /taskkill/i);
    assert.doesNotMatch(op.command, /C:\\Users\\Jean/);
  }
});

test("script: ações fixas, shutdown antes de background, sem taskkill", async () => {
  const texto = await readFile(SCRIPT, "utf8");
  for (const [, action] of ACOES) {
    assert.match(texto, new RegExp(`'${action}'`));
  }
  assert.match(texto, /\/shutdown/);
  assert.match(texto, /\/background/);
  assert.match(texto, /onedrive\.live\.com\/\?v=managestorage/);
  assert.doesNotMatch(texto, /taskkill/i);
});

test("registry: resolve cada id e bloqueia comando livre", async () => {
  clearOperationRegistryCache();
  const reg = await loadOperationRegistry(OPS);
  for (const [id, action, destructive] of ACOES) {
    const out = reg.resolve({ id });
    assert.equal(out.error, undefined, out.error);
    assert.equal(out.id, id);
    assert.equal(out.destructive, destructive);
    assert.match(out.cmd, new RegExp(`-Action ${action}\\b`));
  }
  assert.ok(reg.resolve({ cmd: "taskkill /f /im onedrive.exe" }).error);
});
