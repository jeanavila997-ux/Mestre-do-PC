import test from "node:test";
import { TEST_MCP_TOKEN } from "./helpers/launcher-test-env.js";
import { dashboardHeaders, readDashboardSession } from "./helpers/dashboard-session.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const mcpHeaders = {
  "Content-Type": "application/json",
  "X-Mestre-Client": "mcp",
  "X-Mestre-Mcp-Token": TEST_MCP_TOKEN,
};

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startLauncher(t, extraEnv = {}) {
  const port = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(root, "v10", "launcher.js")], {
    cwd: join(root, "v10"),
    env: { ...process.env, MPC_PORT: String(port), ...extraEnv },
    windowsHide: true,
    stdio: "ignore",
  });
  t.after(() => child.kill());
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(base + "/ping")).ok) return base; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Launcher não iniciou.");
}

test("loopback sem token de sessão não liga Modo Livre nem roda comando", async (t) => {
  const base = await startLauncher(t);
  const semToken = await fetch(base + "/modo-livre", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Mestre-Client": "v10-web" },
    body: JSON.stringify({ enabled: true, confirmacaoHumana: true }),
  });
  assert.equal(semToken.status, 403);

  const anonimo = await fetch(base + "/", { headers: { Accept: "text/html" } });
  assert.equal((await anonimo.text()).includes("mestre-session-token"), false);

  const pagina = await new Promise((resolve, reject) => {
    const url = new URL(base + "/");
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: "/",
      headers: { "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none" },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", reject);
    req.end();
  });
  assert.match(pagina, /mestre-session-token/);
});

test("aprovação humana: permitir, negar, reuso e comando diferente", async (t) => {
  const base = await startLauncher(t);
  const web = await dashboardHeaders(base);

  const pedido = await fetch(base + "/modo-livre", {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(pedido.status, 409);
  const pending = await pedido.json();
  assert.equal(pending.mensagem, "aguardando aprovação");
  assert.ok(pending.approvalId);

  const iaAprova = await fetch(base + `/aprovacoes/${pending.approvalId}/permitir`, {
    method: "POST",
    headers: mcpHeaders,
    body: "{}",
  });
  assert.equal(iaAprova.status, 403);

  const lista = await fetch(base + "/aprovacoes/pendentes", { headers: web });
  assert.equal(lista.status, 200);
  assert.equal((await lista.json()).pendentes.some((item) => item.id === pending.approvalId), true);

  const semSessao = await fetch(base + "/aprovacoes/pendentes", { headers: { "X-Mestre-Client": "v10-web" } });
  assert.equal(semSessao.status, 403);

  const permitido = await fetch(base + `/aprovacoes/${pending.approvalId}/permitir`, {
    method: "POST",
    headers: web,
    body: "{}",
  });
  assert.equal(permitido.status, 200);

  const ligou = await fetch(base + "/modo-livre", {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({ enabled: true, approvalId: pending.approvalId }),
  });
  assert.equal(ligou.status, 200);
  assert.equal((await ligou.json()).enabled, true);

  const reuso = await fetch(base + "/modo-livre", {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({ enabled: true, approvalId: pending.approvalId }),
  });
  assert.equal(reuso.status, 403);

  await fetch(base + "/modo-livre", {
    method: "POST",
    headers: web,
    body: JSON.stringify({ enabled: false }),
  });

  const livre = await fetch(base + "/run-free", {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({ cmd: "Write-Host OK" }),
  });
  assert.equal(livre.status, 409);
  const livreId = (await livre.json()).approvalId;
  assert.equal((await fetch(base + `/aprovacoes/${livreId}/permitir`, { method: "POST", headers: web, body: "{}" })).status, 200);

  const outroComando = await fetch(base + "/run-free", {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({ cmd: "Write-Host OUTRO", approvalId: livreId }),
  });
  assert.equal(outroComando.status, 403);
  assert.match((await outroComando.json()).output, /comando/);

  const certo = await fetch(base + "/run-free", {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({ cmd: "Write-Host OK", approvalId: livreId }),
  });
  assert.equal(certo.status, 202);

  const deNovo = await fetch(base + "/run-free", {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({ cmd: "Write-Host OK", approvalId: livreId }),
  });
  assert.equal(deNovo.status, 403);

  const negarPedido = await fetch(base + "/run-free", {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({ cmd: "Write-Host NAO" }),
  });
  const negarId = (await negarPedido.json()).approvalId;
  assert.equal((await fetch(base + `/aprovacoes/${negarId}/negar`, { method: "POST", headers: web, body: "{}" })).status, 200);
  const negado = await fetch(base + "/run-free", {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({ cmd: "Write-Host NAO", approvalId: negarId }),
  });
  assert.equal(negado.status, 403);

  const token = await readDashboardSession(base);
  assert.equal(web["X-Mestre-Session"], token);
});

test("aprovação expira", async (t) => {
  const base = await startLauncher(t, { MESTRE_APPROVAL_TTL_MS: "40" });
  const web = await dashboardHeaders(base);
  const pedido = await fetch(base + "/modo-livre", {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({ enabled: true }),
  });
  const { approvalId } = await pedido.json();
  await new Promise((resolve) => setTimeout(resolve, 80));
  const expirada = await fetch(base + `/aprovacoes/${approvalId}/permitir`, {
    method: "POST",
    headers: web,
    body: "{}",
  });
  assert.equal(expirada.status, 409);
  assert.match((await expirada.json()).reason, /expirada/);
});
