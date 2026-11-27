// Menu de agentes CLI: um catálogo único (scripts/cli-agents.ps1) espelhado no launcher,
// na whitelist e no index.html. Detecta, mostra versão e abre; nunca instala sozinho.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ESPERADOS = ["claude",  "opencode",  "codex",  "gemini",  "qwen",  "aider",  "copilot",  "cursor",  "grok",  "dsh",  "hermes",  "goose",  "kilo",  "cline",  "crush",  "pi",  "antigravity",  "ori",  "openhands",  "interpreter",  "continue",  "plandex",  "kimi",  "gptme",  "kiro",  "amp",  "droid",  "omp"];

async function idsDoScript() {
  const s = await readFile(join(root, "scripts", "cli-agents.ps1"), "utf8");
  return [...s.matchAll(/\[ordered\]@\{ id = '([\w-]+)'/g)].map((m) => m[1]);
}

test("catálogo do script tem os agentes populares, cada um com abrir e link", async () => {
  const s = await readFile(join(root, "scripts", "cli-agents.ps1"), "utf8");
  const ids = await idsDoScript();
  assert.deepEqual(ids, ESPERADOS);
  for (const id of ids) assert.match(s, new RegExp(`'${id}'`), `ValidateSet sem ${id}`);
  assert.match(s, /'status-json'/);
  for (const linha of s.split(/\r?\n/).filter((l) => /\[ordered\]@\{ id = /.test(l) && !/id = 'omp'/.test(l))) {
    assert.match(linha, /instalar = 'https:\/\//, `sem link de instalação: ${linha.trim()}`);
  }
  assert.match(s, /#Requires -Version 5\.1/);
  assert.doesNotMatch(s, /#Requires -Version 7/);
  assert.doesNotMatch(s, /\?\?/);
  const statusFn = s.slice(s.indexOf("function Get-AgentStatus"), s.indexOf("function Open-AgentTerminal"));
  const guarda = statusFn.indexOf("Major -lt 7");
  const paralelo = statusFn.indexOf("ForEach-Object -ThrottleLimit");
  assert.ok(guarda > 0 && paralelo > guarda, "5.1 não pode cair no -Parallel");
  // Ramo de abrir: agente ausente mostra o link e sai, sem instalar.
  const ramo = s.slice(s.indexOf("  default {"));
  assert.match(ramo, /não instala sozinho/);
  assert.doesNotMatch(ramo, /npm (i|install)|winget|pip install|irm .*\| *iex|curl /i);
});

test("launcher e whitelist usam os mesmos ids", async () => {
  const launcher = await readFile(join(root, "v10", "launcher.js"), "utf8");
  const m = /const CLI_AGENT_IDS = (\[[^\]]+\]);/.exec(launcher);
  assert.ok(m, "CLI_AGENT_IDS ausente no launcher");
  assert.deepEqual(JSON.parse(m[1]), await idsDoScript());
  assert.match(launcher, /new Set\(\["pwsh", "llamacpp", \.\.\.CLI_AGENT_IDS\]\)/);
  assert.match(launcher, /allowAlias:\s*true/);
  assert.match(launcher, /mensagemFalhaAgentesCli/);
  assert.doesNotMatch(launcher, /Falha ao consultar os agentes CLI \(pwsh 7 instalado\?\)/);
  const catalog = JSON.parse(await readFile(join(root, "v10", "allowed-operations.json"), "utf8"));
  for (const id of ESPERADOS) {
    const op = catalog.operations.find((o) => o.id === `cli_agentes_abrir_${id}`);
    assert.ok(op, `cli_agentes_abrir_${id} ausente`);
    assert.equal(op.category, "Agentes CLI");
    assert.equal(op.destructive, false);
    assert.match(op.command, new RegExp(`-Action ${id}$`));
  }
});

test("index.html tem o menu de agentes CLI", async () => {
  const html = await readFile(join(root, "v10", "index.html"), "utf8");
  assert.match(html, /onclick="openCliAgentsMenu\(\)"/);
  assert.match(html, /API \+ "\/cli-agents"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("GET /cli-agents exige cliente autorizado", async (t) => {
  const port = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(root, "v10", "launcher.js")], {
    cwd: join(root, "v10"),
    env: { ...process.env, MPC_PORT: String(port) },
    windowsHide: true,
    stdio: "ignore",
  });
  t.after(() => child.kill());
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(base + "/ping")).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const res = await fetch(base + "/cli-agents");
  assert.equal(res.status, 403);
});

test("o shell do terminal prefere o pwsh 7 real e não usa o atalho de zero bytes", async () => {
  const { resolveShell, isWindowsAppsStub } = await import("../../v10/terminal-launch.js");
  const { join } = await import("node:path");
  const pwsh7 = join("C:\\Program Files", "PowerShell", "7", "pwsh.exe");
  const ps51 = join("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const stub = join("C:\\Users\\Jean\\AppData\\Local\\Microsoft", "WindowsApps", "pwsh.exe");
  const store = join("C:\\Program Files", "WindowsApps", "Microsoft.PowerShell_7.7.0.0_x64__8wekyb3d8bbwe", "pwsh.exe");
  assert.equal(isWindowsAppsStub(stub), true);
  assert.equal(isWindowsAppsStub(store), false);
  assert.equal(resolveShell({ ProgramFiles: "C:\\Program Files", SystemRoot: "C:\\Windows" }, (file) => file === pwsh7), pwsh7);
  assert.equal(resolveShell(
    { ProgramFiles: "C:\\Program Files", SystemRoot: "C:\\Windows", MESTRE_PWSH_PATH: stub },
    (file) => file === stub || file === ps51,
  ), ps51);
  assert.equal(resolveShell(
    { ProgramFiles: "C:\\Program Files", SystemRoot: "C:\\Windows", MESTRE_PWSH_PATH: store },
    (file) => file === store || file === ps51,
  ), store);
});
