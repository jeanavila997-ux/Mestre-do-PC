import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

async function fakeOllama() {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (req.url !== "/api/embed" || req.method !== "POST") {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(raw || "{}");
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        embeddings: inputs.map((text) => String(text).toLowerCase().includes("alpha") ? [1, 0] : [0, 1]),
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

function mcpClient(child) {
  let nextId = 1;
  const pending = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  function request(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout em ${method}`));
      }, 20000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  return { request };
}

function parseToolJson(result) {
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, "text");
  return JSON.parse(result.content[0].text);
}

test("MCP expõe sync_obsidian e search_obsidian com vault e Ollama controlados", { timeout: 60000 }, async (t) => {
  const ollama = await fakeOllama();
  await mkdir(join(ROOT, "temp", "obsidian-mcp-tests"), { recursive: true });
  const fixture = await mkdtemp(join(ROOT, "temp", "obsidian-mcp-tests", "run-"));
  const vault = join(fixture, "vault");
  await mkdir(vault, { recursive: true });
  await writeFile(join(vault, "alpha.md"), "# Memória de teste\n\nalpha conteúdo sintético");
  const child = spawn(process.execPath, [join(ROOT, "mcp-server", "index.js")], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      __COMPAT_LAYER: "RunAsInvoker",
      OBSIDIAN_VAULT_PATH: vault,
      MESTRE_OBSIDIAN_INDEX_DIR: join(fixture, "store"),
      OLLAMA_URL: ollama.url,
      OBSIDIAN_OLLAMA_URL: ollama.url,
      OBSIDIAN_EMBED_MODEL: "test-embed",
      MESTRE_LOCAL_MCP_TOKEN: "token-sintetico-de-teste",
      MESTRE_BASE_URL: "http://127.0.0.1:65534",
    },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    child.stdin.end();
    const exited = await Promise.race([
      new Promise((resolve) => child.once("exit", () => resolve(true))),
      new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);
    if (!exited) child.kill();
    await new Promise((resolve) => ollama.server.close(resolve));
  });

  const client = mcpClient(child);
  await client.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "obsidian-test", version: "1.0.0" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  const list = await client.request("tools/list");
  const names = list.tools.map((tool) => tool.name);
  assert.ok(names.includes("sync_obsidian"));
  assert.ok(names.includes("search_obsidian"));

  const sync = parseToolJson(await client.request("tools/call", { name: "sync_obsidian", arguments: {} }));
  assert.equal(sync.success, true);
  assert.equal(sync.indexedFiles, 1);

  const search = parseToolJson(await client.request("tools/call", { name: "search_obsidian", arguments: { query: "alpha" } }));
  assert.equal(search.results[0].source, "alpha.md");
  assert.equal(search.results[0].contentType, "untrusted_obsidian_note");

  const invalid = await client.request("tools/call", { name: "search_obsidian", arguments: { query: " " } });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /consulta/i);
  assert.doesNotMatch(invalid.content[0].text, /\bat\s+.*obsidian-memory/i);
  assert.doesNotMatch(stderr, /token-sintetico-de-teste/);
});
