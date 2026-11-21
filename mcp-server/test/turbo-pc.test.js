// Turbo PC: diagnóstico (leitura) e otimizar (destrutiva, exige confirmação explícita).
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  TURBO_TOOL_CLASSES,
  buildTurboArgs,
  callTurboTool,
  confirmacaoExplicita,
  turboToolsDefinition,
} from "../../v10/chat-integrado/turbo-pc.js";
import { clearOperationRegistryCache, loadOperationRegistry } from "../../v10/operation-registry.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = join(root, "scripts", "turbo-pc.ps1");
const OPS = join(root, "v10", "allowed-operations.json");

function fakeSpawn(saida, chamadas) {
  return (cmd, args) => {
    chamadas.push({ cmd, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => { child.stdout.emit("data", Buffer.from(JSON.stringify(saida))); child.emit("close", 0); });
    return child;
  };
}

test("classes fixas: diagnóstico é leitura, otimizar é destrutiva", () => {
  assert.equal(TURBO_TOOL_CLASSES.mestre_turbo_diagnostico, "read");
  assert.equal(TURBO_TOOL_CLASSES.mestre_turbo_otimizar, "destructive");
  const defs = Object.fromEntries(turboToolsDefinition().map((t) => [t.name, t]));
  assert.equal(defs.mestre_turbo_diagnostico.annotations.readOnlyHint, true);
  assert.equal(defs.mestre_turbo_otimizar.annotations.destructiveHint, true);
  assert.ok(defs.mestre_turbo_otimizar.inputSchema.properties.confirmar);
});

test("otimizar sem confirmar=true não executa nada", async () => {
  const chamadas = [];
  for (const confirmar of [undefined, false, "talvez", 1, "não"]) {
    const r = await callTurboTool("mestre_turbo_otimizar", { confirmar }, fakeSpawn({}, chamadas));
    assert.equal(r.ok, false);
    assert.equal(r.precisa_confirmacao, true);
    assert.ok(r.o_que_faria.length > 3);
  }
  assert.equal(chamadas.length, 0, "não pode chamar o PowerShell sem confirmação");
  assert.throws(() => buildTurboArgs("otimizar"), /confirmação/);
  assert.throws(() => buildTurboArgs("formatar"), /inválido/);
});

test("otimizar com confirmar=true passa -Confirmar; diagnóstico não", async () => {
  assert.equal(confirmacaoExplicita(true), true);
  assert.equal(confirmacaoExplicita("Sim"), true);
  const chamadas = [];
  const r = await callTurboTool("mestre_turbo_otimizar", { confirmar: true }, fakeSpawn({ ok: true, modo: "otimizar" }, chamadas));
  assert.equal(r.ok, true);
  assert.ok(chamadas[0].args.includes("-Confirmar"));
  assert.deepEqual(chamadas[0].args.slice(-3), ["-Modo", "otimizar", "-Confirmar"]);
  const d = await callTurboTool("mestre_turbo_diagnostico", {}, fakeSpawn({ resumo: "ok" }, chamadas));
  assert.equal(d.resumo, "ok");
  assert.ok(!chamadas[1].args.includes("-Confirmar"));
  assert.ok(chamadas[1].args.includes("diagnostico"));
});

test("script: BOM, confirmação, desfazer e nada perigoso", async () => {
  const buf = await readFile(SCRIPT);
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const s = buf.toString("utf8");
  assert.match(s, /ValidateSet\('diagnostico','otimizar'\)/);
  assert.match(s, /if \(-not \$Confirmar\)/);
  assert.match(s, /desfazer\.ps1/);
  assert.match(s, /rodar-como-admin\.ps1/);
  assert.match(s, /estado-anterior\.json/);
  assert.match(s, /UserGpuPreferences/);
  assert.match(s, /AddHours\(-24\)/);
  // Nunca: esvaziar Lixeira, cache npm, reiniciar, apagar pastas pessoais ou modelos.
  assert.doesNotMatch(s, /Clear-RecycleBin/i);
  assert.doesNotMatch(s, /npm cache/i);
  assert.doesNotMatch(s, /Restart-Computer|shutdown(\.exe)?\s+\/r/i);
  assert.doesNotMatch(s, /Remove-Antigos[^\r\n]*(Downloads|Documents|Desktop|\.ollama|Recycle)/i);
  assert.doesNotMatch(s, /taskkill|Stop-Process/i);
  assert.doesNotMatch(s, /C:\\Users\\Jean/);
});

test("catálogo: turbo_pc_diagnostico (leitura) e turbo_pc_otimizar (destrutiva)", async () => {
  const data = JSON.parse(await readFile(OPS, "utf8"));
  const diag = data.operations.find((op) => op.id === "turbo_pc_diagnostico");
  const otim = data.operations.find((op) => op.id === "turbo_pc_otimizar");
  assert.equal(diag.destructive, false);
  assert.equal(otim.destructive, true);
  assert.match(diag.command, /scripts\\turbo-pc\.ps1/);
  assert.match(diag.command, /-Modo diagnostico\b/);
  assert.doesNotMatch(diag.command, /-Confirmar/);
  assert.match(otim.command, /-Modo otimizar -Confirmar/);
  clearOperationRegistryCache();
  const reg = await loadOperationRegistry(OPS);
  assert.equal(reg.resolve({ id: "turbo_pc_otimizar" }).destructive, true);
  assert.equal(reg.resolve({ id: "turbo_pc_diagnostico" }).destructive, false);
});

test("ponte MCP expõe e encaminha as ferramentas Turbo PC", async () => {
  const src = await readFile(join(root, "v10", "chat-integrado", "grokbot-bridge.js"), "utf8");
  assert.match(src, /turboToolsDefinition\(\)/);
  assert.match(src, /isTurboTool\(name\)/);
  assert.match(src, /callTurboTool\(name, args\)/);
});

test("relatórios: LastBootUpTime do Get-CimInstance já é DateTime (sem DMTF)", async () => {
  // Get-CimInstance devolve DateTime; o conversor DMTF lança e o uptime saía "d h".
  const data = JSON.parse(await readFile(OPS, "utf8"));
  const quebrados = data.operations.filter((op) => /Get-CimInstance/.test(op.command) && /ManagementDateTimeConverter\]::ToDateTime\(\$os\.LastBootUpTime\)/.test(op.command)).map((op) => op.id);
  assert.deepEqual(quebrados, []);
});
