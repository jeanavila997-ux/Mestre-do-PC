import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(repoRoot, "scripts", "instalar-mcp-clientes.ps1");
const tempRoot = process.env.TEMP || os.tmpdir();

function fixture(t) {
  const root = fs.mkdtempSync(path.join(tempRoot, "mcp-installer-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  const config = path.join(root, "config");
  fs.mkdirSync(path.join(project, "mcp-server"), { recursive: true });
  fs.mkdirSync(path.join(project, "v10"), { recursive: true });
  fs.writeFileSync(path.join(project, "mcp-server", "index.js"), "// fixture\n");
  fs.writeFileSync(path.join(project, "v10", "launcher.js"), "// fixture\n");
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ version: "11.2.1", engines: { node: ">=22.13.0" } }));
  return { root, project, config };
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function run(args, env = {}) {
  return spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", installer, ...args],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
}

function paths(config) {
  return {
    opencode: path.join(config, ".config", "opencode", "opencode.json"),
    claudeCode: path.join(config, ".claude.json"),
    claudeDesktop: path.join(config, "AppData", "Roaming", "Claude", "claude_desktop_config.json"),
    cline: path.join(config, ".cline", "data", "settings", "cline_mcp_settings.json"),
    codex: path.join(config, ".codex", "config.toml"),
    grok: path.join(config, ".grok", "config.toml"),
  };
}

function assertCommon(server, project, nodePath) {
  assert.equal(server.command, nodePath);
  assert.deepEqual(server.args, [path.join(project, "mcp-server", "index.js")]);
  assert.equal(server.env.MESTRE_PROJETO_PATH, project);
  assert.equal(server.env.MESTRE_BASE_URL, "http://127.0.0.1:7777");
}

test("WhatIf não altera configurações existentes", (t) => {
  const { project, config } = fixture(t);
  const files = paths(config);
  const original = JSON.stringify({ mcp: { servers: { existing: { type: "remote", url: "https://example.com/mcp" } } } }, null, 2);
  write(files.opencode, original);

  const result = run(["-ProjectRoot", project, "-ConfigRoot", config, "-NodePath", process.execPath, "-Client", "OpenCode", "-WhatIf"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(files.opencode, "utf8"), original);
  assert.equal(fs.readdirSync(path.dirname(files.opencode)).some((name) => name.includes(".bak-mcp-installer-")), false);
});

test("instala todos os clientes, preserva configurações e cria backups", (t) => {
  const { project, config } = fixture(t);
  const files = paths(config);
  write(files.opencode, JSON.stringify({ mcp: { servers: { existing: { type: "remote", url: "https://example.com/mcp" } } } }));
  write(files.claudeCode, JSON.stringify({ mcpServers: { existing: { command: "node" } } }));
  write(files.claudeDesktop, JSON.stringify({ mcpServers: { existing: { command: "node" } } }));
  write(files.cline, JSON.stringify({ mcpServers: { existing: { transport: { type: "stdio", command: "node" } } } }));
  write(files.codex, '[mcp_servers.existing]\ncommand = "node"\n');
  write(files.grok, '[mcp_servers.existing]\nurl = "https://example.com/mcp"\n');

  const result = run(["-ProjectRoot", project, "-ConfigRoot", config, "-NodePath", process.execPath, "-Client", "All"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const opencode = readJson(files.opencode);
  assert.equal(opencode.mcp.servers.existing.url, "https://example.com/mcp");
  assert.equal(opencode.mcp.servers["mestre-do-pc"].type, "local");
  assert.deepEqual(opencode.mcp.servers["mestre-do-pc"].command, [process.execPath, path.join(project, "mcp-server", "index.js")]);
  assert.equal(opencode.mcp.servers["mestre-do-pc"].cwd, project);
  assert.equal(opencode.mcp.servers["mestre-do-pc"].environment.MESTRE_BASE_URL, "http://127.0.0.1:7777");

  for (const file of [files.claudeCode, files.claudeDesktop]) {
    const data = readJson(file);
    assert.ok(data.mcpServers.existing);
    assertCommon(data.mcpServers["mestre-do-pc"], project, process.execPath);
  }

  const cline = readJson(files.cline);
  assert.ok(cline.mcpServers.existing);
  assertCommon(cline.mcpServers["mestre-do-pc"].transport, project, process.execPath);

  const codex = fs.readFileSync(files.codex, "utf8");
  const grok = fs.readFileSync(files.grok, "utf8");
  assert.match(codex, /\[mcp_servers\.mestre_do_pc\]/);
  assert.match(grok, /\[mcp_servers\.mestre-do-pc\]/);
  assert.ok(codex.includes("[mcp_servers.existing]"));
  assert.ok(grok.includes("[mcp_servers.existing]"));
  assert.ok(codex.includes(JSON.stringify(process.execPath)));
  assert.ok(grok.includes(JSON.stringify(process.execPath)));
  assert.ok(codex.includes(JSON.stringify(path.join(project, "mcp-server", "index.js"))));
  assert.ok(grok.includes(JSON.stringify(path.join(project, "mcp-server", "index.js"))));

  for (const file of Object.values(files)) {
    const backups = fs.readdirSync(path.dirname(file)).filter((name) => name.startsWith(`${path.basename(file)}.bak-mcp-installer-`));
    assert.equal(backups.length, 1, `backup ausente para ${file}`);
  }
});

test("WhatIf funciona no PowerShell 7", (t) => {
  const available = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", "exit 0"]);
  if (available.status !== 0) {
    t.skip("pwsh.exe indisponível");
    return;
  }
  const { project, config } = fixture(t);
  const result = spawnSync(
    "pwsh.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", installer, "-ProjectRoot", project, "-ConfigRoot", config, "-NodePath", process.execPath, "-Client", "OpenCode", "-WhatIf"],
    { encoding: "utf8", env: process.env },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(paths(config).opencode), false);
});

test("recusa projeto sem mcp-server/index.js", (t) => {
  const { project, config } = fixture(t);
  fs.rmSync(path.join(project, "mcp-server", "index.js"));
  const result = run(["-ProjectRoot", project, "-ConfigRoot", config, "-NodePath", process.execPath, "-Client", "OpenCode"]);
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(paths(config).opencode), false);
});

test("não grava o token do ambiente nas configurações", (t) => {
  const { project, config } = fixture(t);
  const sentinel = "token-sentinel-nao-gravar";
  const result = run(["-ProjectRoot", project, "-ConfigRoot", config, "-NodePath", process.execPath, "-Client", "All"], { MESTRE_LOCAL_MCP_TOKEN: sentinel });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const file of Object.values(paths(config))) {
    assert.equal(fs.readFileSync(file, "utf8").includes(sentinel), false);
  }
});

test("recusa nome de cliente inválido", (t) => {
  const { project, config } = fixture(t);
  const result = run(["-ProjectRoot", project, "-ConfigRoot", config, "-NodePath", process.execPath, "-Client", "Inexistente"]);
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(paths(config).opencode), false);
});
