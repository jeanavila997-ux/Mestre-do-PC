// Administração pela extensão: operações fixas admin_* com classes e confirmação.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { ADMIN_OPS } from "../../browser-extension/tools-core.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = join(root, "scripts", "admin-tools.ps1");

async function catalog() {
  return JSON.parse(await readFile(join(root, "v10", "allowed-operations.json"), "utf8"));
}

const actionOf = (id) => id.slice("admin_".length).replaceAll("_", "-");

test("cada operação da extensão existe no catálogo com a mesma classe e confirmação", async () => {
  const byId = new Map((await catalog()).operations.map((op) => [op.id, op]));
  for (const op of ADMIN_OPS) {
    const entry = byId.get(op.id);
    assert.ok(entry, `faltando no catálogo: ${op.id}`);
    assert.equal(entry.category, "Administração");
    assert.equal(entry.classe, op.classe, op.id);
    assert.equal(entry.elevado, op.elevado, op.id);
    assert.equal(entry.confirmacao, op.confirmacao, op.id);
    // Tudo que pede confirmação vira destructive no catálogo (destructiveHint no MCP).
    assert.equal(entry.destructive, op.confirmacao !== "nenhuma", op.id);
    assert.ok(entry.command.endsWith(`scripts\\admin-tools.ps1') -Action ${actionOf(op.id)}`), entry.command);
  }
  const catalogAdmin = [...byId.values()].filter((o) => o.category === "Administração").map((o) => o.id).sort();
  assert.deepEqual(catalogAdmin, ADMIN_OPS.map((o) => o.id).sort());
});

test("admin-tools.ps1: ValidateSet fechado e elevação só por RunAs", async () => {
  const s = await readFile(SCRIPT, "utf8");
  for (const op of ADMIN_OPS) assert.match(s, new RegExp(`'${actionOf(op.id)}'`), `ValidateSet sem ${op.id}`);
  assert.match(s, /Start-Process -FilePath 'powershell\.exe' -Verb RunAs/);
  assert.match(s, /-not \(Test-Admin\)/);
  const elevadas = [...s.matchAll(/^\s+'([a-z-]+)'\s+= '/gm)].map((m) => m[1]).sort();
  const esperadas = ADMIN_OPS.filter((o) => o.elevado).map((o) => actionOf(o.id)).sort();
  assert.deepEqual(elevadas, esperadas, "lista de elevadas do script difere da extensão");
});

test("admin-tools.ps1 não tem comandos proibidos", async () => {
  const s = await readFile(SCRIPT, "utf8");
  for (const bad of [/Clear-RecycleBin/i, /\$Recycle\.Bin/i, /Set-MpPreference/i, /DisableRealtimeMonitoring/i,
    /EnableLUA/i, /advfirewall/i, /Set-NetFirewallProfile/i, /Restart-Computer/i, /Stop-Computer/i,
    /shutdown(\.exe)? \/[rs] \/t 0\b/i, /Invoke-Expression|\biex\b/i, /Format-Volume|Clear-Disk|Remove-Partition/i,
    /\$env:USERPROFILE\\(Documents|Desktop|Downloads|Pictures)/i]) {
    assert.doesNotMatch(s, bad, `encontrado ${bad}`);
  }
  assert.match(s, /shutdown\.exe \/r \/t 60/);
  assert.match(s, /shutdown\.exe \/s \/t 60/);
  assert.match(s, /shutdown\.exe \/a/);
});

test("reiniciar/desligar o PC exigem confirmação dupla; leitura não pede", () => {
  for (const id of ["admin_reiniciar_pc", "admin_desligar_pc"]) {
    const op = ADMIN_OPS.find((o) => o.id === id);
    assert.equal(op.confirmacao, "dupla");
    assert.equal(op.classe, "destrutiva");
    assert.ok(op.palavra);
  }
  for (const op of ADMIN_OPS.filter((o) => o.elevado)) assert.notEqual(op.confirmacao, "nenhuma", op.id);
});

test("registry MCP publica as admin_* com destructiveHint espelhando a confirmação", async () => {
  const { OperationRegistry } = await import(pathToFileURL(join(root, "v10", "operation-registry.js")).href);
  const registry = new OperationRegistry(await catalog());
  const schemas = new Map(registry.buildMcpToolSchemas().map((t) => [t.name, t]));
  for (const op of ADMIN_OPS) {
    const tool = schemas.get(op.id);
    assert.ok(tool, `tool MCP ausente: ${op.id}`);
    assert.equal(tool.annotations.destructiveHint, op.confirmacao !== "nenhuma", op.id);
  }
  const r = registry.resolve({ id: "admin_reiniciar_pc" });
  assert.equal(r.destructive, true);
  assert.ok(registry.resolve({ cmd: "shutdown /r /t 0" }).error, "comando livre deve ser bloqueado");
});

test("/shutdown do launcher encerra a árvore dos jobs e fecha conexões keep-alive", async () => {
  const s = await readFile(join(root, "v10", "launcher.js"), "utf8");
  assert.match(s, /function killProcessTree\(child\)/);
  assert.match(s, /taskkill\.exe", \["\/PID", String\(child\.pid\), "\/T", "\/F"\]/);
  assert.match(s, /server\.closeAllConnections\?\.\(\)/);
});
