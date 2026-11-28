// Segurança restante: backup do registro, comandos que exigem admin e
// parâmetros que começam com "-".
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { OperationRegistry } from "../../v10/operation-registry.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

async function catalogo() {
  return JSON.parse(await readFile(join(root, "v10", "allowed-operations.json"), "utf8"));
}
const comando = (o) => o.command || o.pattern || "";
const ESCRITA_REGISTRO = /\b(Set-ItemProperty|New-ItemProperty|Remove-ItemProperty)\b/i;
const MARCA_BACKUP = "Write-Host ('Backup do registro em ' + $bk) -ForegroundColor DarkGray; ";

test("todo comando que altera o registro faz backup antes e pede confirmação", async () => {
  const c = await catalogo();
  const alvos = [...c.operations, ...c.templates.filter((t) => t.command)].filter((o) => ESCRITA_REGISTRO.test(comando(o)));
  assert.ok(alvos.length >= 18, `esperava pelo menos 18, achei ${alvos.length}`);
  for (const o of alvos) {
    const cmd = comando(o);
    const fim = cmd.indexOf(MARCA_BACKUP);
    assert.ok(fim > 0, `${o.id}: sem backup`);
    const prefixo = cmd.slice(0, fim);
    // O backup vem antes de qualquer escrita e aborta se o reg export falhar.
    assert.ok(cmd.search(ESCRITA_REGISTRO) > fim, `${o.id}: escreve antes do backup`);
    assert.match(prefixo, /reg export \$c \$arq \/y/);
    assert.match(prefixo, /if \(\$LASTEXITCODE -ne 0\) \{[^}]*exit 1 \}/);
    assert.match(prefixo, new RegExp(`'${o.id}-' \\+ \\$n`));
    // Cada chave escrita está na lista do backup.
    for (const m of cmd.slice(fim).matchAll(/['"](HK(?:CU|LM)):\\([^'"]+)['"]/g)) {
      assert.ok(prefixo.includes(`'${m[1]}\\${m[2]}'`), `${o.id}: chave ${m[1]}:\\${m[2]} fora do backup`);
    }
    assert.equal(o.destructive, true, `${o.id}: precisa de confirmação`);
  }
});

test("existe como listar e restaurar os backups do registro", async () => {
  const c = await catalogo();
  const listar = c.operations.find((o) => o.id === "listar_backups_registro");
  assert.ok(listar);
  assert.equal(listar.destructive, false);
  const restaurar = c.templates.find((t) => t.id === "restaurar_backup_registro");
  assert.ok(restaurar);
  assert.equal(restaurar.destructive, true);
  const reg = new OperationRegistry(c);
  const ok = reg.resolve({ id: "restaurar_backup_registro", params: { arquivo: "desativar_cortana-1-20261128-071500.reg" } });
  assert.ok(!ok.error, ok.error);
  assert.match(ok.cmd, /reg import \$arq/);
  for (const ruim of ["..\\..\\x.reg", "C:\\x.reg", "x.reg", "desativar_cortana-1-20261128-071500.reg; calc", "-1-20261128-071500.reg"]) {
    assert.ok(reg.resolve({ id: "restaurar_backup_registro", params: { arquivo: ruim } }).error, `aceitou ${ruim}`);
  }
});

test("comandos que exigem admin estão marcados; os de Administração (UAC) não", async () => {
  const c = await catalogo();
  const porId = new Map([...c.operations, ...c.templates].map((o) => [o.id, o]));
  for (const id of ["sfc_scan_reparo_de_arquivos", "dism_restaurar_saude", "resetar_pilha_tcp_ip", "limpar_cache_do_windows_update", "desativar_cortana", "bloquear_ip_firewall", "criar_ponto_de_restauracao"]) {
    assert.equal(porId.get(id)?.requerAdmin, true, id);
  }
  for (const o of c.operations.filter((x) => x.category === "Administração")) {
    assert.notEqual(o.requerAdmin, true, `${o.id} já eleva pelo UAC`);
  }
  // Escrita só em HKCU não exige admin.
  assert.notEqual(porId.get("desativar_animacoes_do_windows").requerAdmin, true);
});

test("parâmetro que começa com '-' é recusado (injeção de argumento)", async () => {
  const reg = new OperationRegistry(await catalogo());
  assert.ok(reg.resolve({ id: "encerrar_processo", params: { nome: "-Force" } }).error);
  assert.ok(reg.resolve({ id: "instalar_pacote_npm_global", params: { pacote: "--prefix" } }).error);
  assert.ok(!reg.resolve({ id: "encerrar_processo", params: { nome: "notepad" } }).error);
});

test("launcher bloqueia comando requerAdmin sem elevação e detecta admin pelo whoami", async () => {
  const s = await readFile(join(root, "v10", "launcher.js"), "utf8");
  assert.match(s, /spawn\("whoami", \["\/groups"\]/);
  assert.match(s, /S-1-16-\(12288\|16384\)/);
  assert.match(s, /op\.requerAdmin === true && !isElevated/);
  assert.match(s, /if \(precisaAdmin\(resolved\.id\)\) \{\s*return sendJson\(res, 403, \{ success: false, output: MSG_PRECISA_ADMIN, state: "needs_admin"/);
  assert.match(s, /if \(precisaAdmin\(operationId\)\) throw new Error\(MSG_PRECISA_ADMIN\)/);
});

test("install.ps1 exige o admin-tools.ps1", async () => {
  const s = await readFile(join(root, "install.ps1"), "utf8");
  assert.match(s, /"scripts\\admin-tools\.ps1",/);
});

test("Windows: o backup do registro gera o .reg de verdade", { skip: process.platform !== "win32" && "só roda no Windows" }, async () => {
  const c = await catalogo();
  const op = c.operations.find((o) => o.id === "desativar_animacoes_do_windows");
  const cmd = op.command;
  const prefixo = cmd.slice(0, cmd.indexOf(MARCA_BACKUP) + MARCA_BACKUP.length);
  const dir = await mkdtemp(join(tmpdir(), "mestre-bk-"));
  try {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", prefixo], {
      encoding: "utf8",
      env: { ...process.env, LOCALAPPDATA: dir },
      timeout: 60000,
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const arquivos = await readdir(join(dir, "MestreDoPC", "backup-registro"));
    assert.equal(arquivos.length, 1);
    assert.match(arquivos[0], /^desativar_animacoes_do_windows-1-\d{8}-\d{6}\.reg$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
