import test from "node:test";
import { TEST_MCP_TOKEN } from "./helpers/launcher-test-env.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// O endpoint /mcp (Streamable HTTP) executa ferramentas do Mestre (whitelist,
// limpeza, memória, 9Router). Ele precisa exigir o token local em todo POST e
// recusar Content-Type diferente de JSON (evita POST "simples" de páginas web).

const root = fileURLToPath(new URL("../../", import.meta.url));

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForServer(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url + "/ping")).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Launcher Node não iniciou no prazo.");
}

const LIST = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

test("/mcp exige token e JSON em todo POST", async (t) => {
  const port = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(root, "v10", "launcher.js")], {
    cwd: join(root, "v10"),
    env: { ...process.env, MPC_PORT: String(port) },
    windowsHide: true,
    stdio: "ignore",
  });
  t.after(() => child.kill());
  await waitForServer(base);

  const semToken = await fetch(base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: LIST });
  assert.equal(semToken.status, 401);
  const semTokenBody = await semToken.json();
  assert.equal(semTokenBody.error?.code, -32001);

  const tokenErrado = await fetch(base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", "X-Mestre-Mcp-Token": "errado" }, body: LIST });
  assert.equal(tokenErrado.status, 401);

  const textoSimples = await fetch(base + "/mcp", { method: "POST", headers: { "Content-Type": "text/plain", "X-Mestre-Mcp-Token": TEST_MCP_TOKEN }, body: LIST });
  assert.equal(textoSimples.status, 415);

  const comHeader = await fetch(base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", "X-Mestre-Mcp-Token": TEST_MCP_TOKEN }, body: LIST });
  assert.equal(comHeader.status, 200);
  const tools = (await comHeader.json()).result?.tools ?? [];
  assert.ok(tools.some((tool) => tool.name === "mestre_system_status"));

  const comBearer = await fetch(base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${TEST_MCP_TOKEN}` }, body: LIST });
  assert.equal(comBearer.status, 200);

  // GET continua público, mas só com status (sem executar nada).
  const status = await fetch(base + "/mcp");
  assert.equal(status.status, 200);
});
