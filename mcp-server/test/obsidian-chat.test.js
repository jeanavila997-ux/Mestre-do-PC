import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { buildObsidianEvidenceMessage, fetchObsidianEvidence } from "../../v10/chat-integrado/obsidian-chat.js";

const evidence = {
  results: [{
    source: "nota.md",
    modifiedAt: "2026-11-24T00:00:00.000Z",
    score: 0.91,
    heading: "Teste",
    text: "conteúdo sintético",
    contentType: "untrusted_obsidian_note",
  }],
};

test("evidência do Obsidian vira contexto citável e não confiável", () => {
  const message = buildObsidianEvidenceMessage(evidence);
  assert.equal(message.role, "system");
  assert.match(message.content, /não confiáv/i);
  assert.match(message.content, /nota\.md/);
  assert.match(message.content, /2026-11-24/);
  assert.match(message.content, /\[Memória Obsidian\]/);
  assert.equal(buildObsidianEvidenceMessage({ results: [] }), null);
});

test("busca automática usa a tool correta, limita consulta e falha sem derrubar o chat", async () => {
  let received;
  const message = await fetchObsidianEvidence("alpha", {
    post: async (path, body) => {
      received = { path, body };
      return { success: true, result: evidence };
    },
  });
  assert.equal(received.path, "/api/tools/search_obsidian");
  assert.deepEqual(received.body, { query: "alpha", limit: 5 });
  assert.equal(message.role, "system");

  let longQuery;
  await fetchObsidianEvidence("a".repeat(600), {
    post: async (_path, body) => { longQuery = body.query; return { success: true, result: { results: [] } }; },
  });
  assert.equal(longQuery.length, 500);
  assert.equal(await fetchObsidianEvidence("alpha", { post: async () => ({ success: false }) }), null);
  assert.equal(await fetchObsidianEvidence("alpha", { post: async () => { throw new Error("offline"); } }), null);
});

test("tools HTTP do launcher sincronizam e pesquisam o vault controlado", { timeout: 30000 }, async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "mestre-obsidian-http-"));
  const vault = join(fixture, "vault");
  await mkdir(vault, { recursive: true });
  await writeFile(join(vault, "alpha.md"), "alpha evidência HTTP");
  const ollama = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ embeddings: inputs.map((text) => String(text).includes("alpha") ? [1, 0] : [0, 1]) }));
    });
  });
  await new Promise((resolve) => ollama.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => ollama.close(resolve)));
  process.env.OBSIDIAN_VAULT_PATH = vault;
  process.env.MESTRE_OBSIDIAN_INDEX_DIR = join(fixture, "store");
  process.env.OBSIDIAN_OLLAMA_URL = `http://127.0.0.1:${ollama.address().port}`;
  process.env.OBSIDIAN_EMBED_MODEL = "test-embed";
  process.env.MESTRE_ENV_LOCAL_PATH = join(fixture, "env-inexistente");
  process.env.MESTRE_AUDIT_LOG_DIR = join(fixture, "logs");

  const { executarTool } = await import(`../../v10/chat-integrado/tools-api.js?obsidian-test=${Date.now()}`);
  const sync = await executarTool("sync_obsidian", {});
  assert.equal(sync.indexedFiles, 1);
  const search = await executarTool("search_obsidian", { query: "alpha" });
  assert.equal(search.results[0].source, "alpha.md");
});
