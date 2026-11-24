import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import "./helpers/launcher-test-env.js";
import { CATALOG } from "../../v10/providers/index.js";

const ENV_KEYS = ["JARVIS_URL", "JARVIS_USER", "JARVIS_PASS", "MPC_PROVIDERS_FILE"];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(saved) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

async function loadIsolated(t) {
  const dir = mkdtempSync(join(process.cwd(), ".jarvis-provider-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  process.env.MPC_PROVIDERS_FILE = join(dir, "providers.json");
  return import(`../../v10/providers/index.js?jarvis=${Date.now()}-${Math.random()}`);
}

test("catálogo registra o JARVIS sem expor a senha", () => {
  const entry = CATALOG.jarvis;
  assert.equal(entry.type, "jarvis");
  assert.equal(entry.baseUrl, "http://127.0.0.1:3200");
  assert.equal(entry.envKey, "JARVIS_PASS");
  assert.equal(entry.envUser, "JARVIS_USER");
  assert.equal(entry.implemented, true);
});

test("JARVIS local funciona sem senha e interpreta NDJSON", async (t) => {
  const saved = snapshotEnv();
  delete process.env.JARVIS_URL;
  delete process.env.JARVIS_USER;
  delete process.env.JARVIS_PASS;
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response([
      JSON.stringify({ tipo: "inicio" }),
      JSON.stringify({ tipo: "delta", texto: "Olá, " }),
      JSON.stringify({ tipo: "delta", texto: "Jean." }),
      JSON.stringify({ tipo: "fim" }),
      "",
    ].join("\n"), { status: 200 });
  };
  try {
    const mod = await loadIsolated(t);
    const listed = mod.listProviders().providers.find((p) => p.id === "jarvis");
    assert.equal(listed.configured, true);
    assert.equal(listed.enabled, true);
    assert.equal(listed.hasKey, false);
    const result = await mod.chat([{ role: "user", content: "oi" }], { provider: "jarvis" });
    assert.equal(result.content, "Olá, Jean.");
    assert.equal(request.url, "http://127.0.0.1:3200/api/chat");
    assert.equal(request.options.headers["X-Jarvis"], "1");
    assert.equal(request.options.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(request.options.body), { mensagem: "oi" });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("JARVIS remoto exige HTTPS e usa Basic Auth somente no backend", async (t) => {
  const saved = snapshotEnv();
  process.env.JARVIS_URL = "https://jarvis.example";
  process.env.JARVIS_USER = "jean";
  process.env.JARVIS_PASS = "segredo-de-teste";
  const originalFetch = globalThis.fetch;
  let headers;
  globalThis.fetch = async (_url, options) => {
    headers = options.headers;
    return new Response(JSON.stringify({ tipo: "delta", texto: "ok" }) + "\n", { status: 200 });
  };
  try {
    const mod = await loadIsolated(t);
    const provider = mod.getProvider("jarvis");
    assert.equal(provider.baseUrl, "https://jarvis.example");
    assert.equal(provider.configured, true);
    await mod.chat([{ role: "user", content: "status" }], { provider: "jarvis" });
    assert.equal(headers.Authorization, `Basic ${Buffer.from("jean:segredo-de-teste").toString("base64")}`);
    const publicState = mod.listProviders().providers.find((p) => p.id === "jarvis");
    assert.equal("apiKey" in publicState, false);

    process.env.JARVIS_URL = "http://jarvis.example";
    const invalid = await loadIsolated(t);
    assert.equal(invalid.getProvider("jarvis").baseUrl, "http://127.0.0.1:3200");
    assert.throws(() => invalid.updateProvider("jarvis", { baseUrl: "http://jarvis.example" }), /HTTPS/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});
