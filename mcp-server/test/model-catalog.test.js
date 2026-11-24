import test from "node:test";
import assert from "node:assert/strict";
import { getLiveModels, isChatModel, isEmbeddingModel } from "../model-catalog.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("catálogo distingue modelos de chat e embedding", () => {
  assert.equal(isEmbeddingModel("nomic-embed-text:latest"), true);
  assert.equal(isEmbeddingModel("bge-m3"), true);
  assert.equal(isChatModel("nomic-embed-text"), false);
  assert.equal(isChatModel("qwen3.5:4b"), true);
});

test("getLiveModels lê /api/tags e normaliza os modelos disponíveis", async () => {
  let requestedUrl;
  const models = await getLiveModels({
    baseUrl: "http://127.0.0.1:11434",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [
          { name: "qwen3.5:4b", model: "qwen3.5:4b", modified_at: "2026-11-24T00:00:00Z", size: 3300, details: { parameter_size: "4B" } },
          { name: "nomic-embed-text:latest", model: "nomic-embed-text:latest", modified_at: "2026-11-24T01:00:00Z", size: 274000000, details: {} },
        ] }),
      };
    },
  });
  assert.equal(requestedUrl, "http://127.0.0.1:11434/api/tags");
  assert.deepEqual(models.map((model) => model.capability), ["embedding", "chat"]);
  assert.equal(models.find((model) => model.capability === "embedding").size, 274000000);
});

test("getLiveModels não devolve corpo de erro do Ollama", async () => {
  await assert.rejects(getLiveModels({
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: "detalhe interno" }) }),
  }), /Ollama.*503/);
});

test("models:live recusa qualquer argumento desconhecido", () => {
  const script = fileURLToPath(new URL("../../scripts/modelos-disponiveis.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--invalido"], { encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Uso:/);
});
