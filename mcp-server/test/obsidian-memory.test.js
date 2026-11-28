import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, readFile, rename, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chunkMarkdown, cosineSimilarity, syncObsidian, searchObsidian } from "../obsidian-memory.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_ROOT = join(__dirname, "..", "..", "temp", "obsidian-memory-tests");

// O vault precisa estar dentro da pasta do usuário. No PC de desenvolvimento o
// repo fica em C:\Users\<nome>, mas no runner do Actions o checkout fica em
// D:\a\... (fora do perfil), então a home deste processo de teste aponta para
// a raiz das fixtures. Cada arquivo de teste roda em processo próprio.
process.env.USERPROFILE = TEST_ROOT;
process.env.HOME = TEST_ROOT;

async function fixture(t) {
  await mkdir(TEST_ROOT, { recursive: true });
  const root = await mkdtemp(join(TEST_ROOT, "run-"));
  const vaultPath = join(root, "vault");
  const storeDir = join(root, "store");
  await mkdir(vaultPath, { recursive: true });
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        embeddings: inputs.map((text) => {
          const value = String(text).toLowerCase();
          if (value.includes("alpha")) return [1, 0];
          if (value.includes("beta")) return [0, 1];
          return [0.5, 0.5];
        }),
      }),
    };
  };
  const options = { vaultPath, storeDir, fetchImpl, model: "test-embed" };
  return { root, vaultPath, storeDir, calls, options };
}

test("chunkMarkdown limita chunks e preserva posições ordenadas", () => {
  const chunks = chunkMarkdown(`# Título\n\n${"alpha ".repeat(80)}`, { maxChars: 100, overlap: 20 });
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every((chunk) => chunk.text.length > 0 && chunk.text.length <= 100));
  assert.equal(chunks[0].start, 0);
  assert.ok(chunks.at(-1).end > chunks[0].end);
  assert.equal(chunks[0].heading, "Título");
});

test("cosineSimilarity calcula valores conhecidos e rejeita dimensões divergentes", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0);
  assert.throws(() => cosineSimilarity([1], [1, 0]), /dimens/i);
});

test("syncObsidian indexa somente Markdown permitido sem registrar caminhos sensíveis", async () => {
  const { vaultPath, options } = await fixture();
  await mkdir(join(vaultPath, "chaves"), { recursive: true });
  await mkdir(join(vaultPath, ".secrets"), { recursive: true });
  await mkdir(join(vaultPath, ".obsidian"), { recursive: true });
  await mkdir(join(vaultPath, "Referencias"), { recursive: true });
  await mkdir(join(vaultPath, "node_modules", "pacote"), { recursive: true });
  await writeFile(join(vaultPath, "normal.md"), "alpha público");
  await writeFile(join(vaultPath, "chaves", "privado.md"), "beta privado");
  await writeFile(join(vaultPath, ".secrets", "oculto.md"), "beta oculto");
  await writeFile(join(vaultPath, ".obsidian", "config.md"), "beta config");
  await writeFile(join(vaultPath, "Referencias", "referencia.md"), "beta referência");
  await writeFile(join(vaultPath, "node_modules", "pacote", "readme.md"), "beta dependência");
  await writeFile(join(vaultPath, ".env.md"), "beta sensível");
  await writeFile(join(vaultPath, "nota.txt"), "beta fora do formato");

  const stats = await syncObsidian(options);
  assert.equal(stats.indexedFiles, 1);
  const stored = await readFile(join(options.storeDir, "obsidian-index.json"), "utf8");
  assert.match(stored, /normal\.md/);
  assert.doesNotMatch(stored, /privado|oculto|config\.md|referencia|dependência|sensível|fora do formato/i);
});

test("syncObsidian não segue junction para fora do vault", async (t) => {
  const { root, vaultPath, options } = await fixture();
  const outside = join(root, "fora");
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "externa.md"), "beta externo");
  await writeFile(join(vaultPath, "local.md"), "alpha local");
  try {
    await symlink(outside, join(vaultPath, "atalho-externo"), "junction");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") return t.skip("Junction não permitida neste ambiente");
    throw error;
  }
  const stats = await syncObsidian(options);
  assert.equal(stats.indexedFiles, 1);
  const stored = await readFile(join(options.storeDir, "obsidian-index.json"), "utf8");
  assert.match(stored, /local\.md/);
  assert.doesNotMatch(stored, /externa|beta externo/);
});

test("syncObsidian reutiliza vetores, atualiza edições, remove ausentes e troca modelo", async () => {
  const { vaultPath, options, calls } = await fixture();
  const alpha = join(vaultPath, "alpha.md");
  const beta = join(vaultPath, "beta.md");
  await writeFile(alpha, "# Alpha\n\nalpha inicial");
  await writeFile(beta, "# Beta\n\nbeta inicial");

  const first = await syncObsidian(options);
  assert.equal(first.indexedFiles, 2);
  assert.equal(first.embeddedChunks, 2);
  assert.equal(first.reusedChunks, 0);

  const second = await syncObsidian(options);
  assert.equal(second.embeddedChunks, 0);
  assert.equal(second.reusedChunks, 2);
  assert.equal(calls.length, 1);

  await writeFile(alpha, "# Alpha\n\nalpha atualizado com conteúdo novo");
  const edited = await syncObsidian(options);
  assert.equal(edited.embeddedChunks, 1);
  assert.equal(edited.reusedChunks, 1);

  await rename(beta, join(vaultPath, "beta.md.ignore"));
  const removed = await syncObsidian(options);
  assert.equal(removed.indexedFiles, 1);
  assert.equal(removed.removedFiles, 1);

  const changedModel = await syncObsidian({ ...options, model: "outro-modelo" });
  assert.equal(changedModel.model, "outro-modelo");
  assert.equal(changedModel.embeddedChunks, 1);
  assert.equal(changedModel.reusedChunks, 0);
});

test("syncObsidian falha sem gravar índice quando o Ollama retorna erro", async () => {
  const { vaultPath, options } = await fixture();
  await writeFile(join(vaultPath, "alpha.md"), "alpha");
  const failingOptions = {
    ...options,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: "não propagar" }) }),
  };
  await assert.rejects(syncObsidian(failingOptions), /Ollama.*401/);
  await assert.rejects(readFile(join(options.storeDir, "obsidian-index.json"), "utf8"), /ENOENT/);
});

test("syncObsidian rejeita vetores com dimensões inconsistentes", async () => {
  const { vaultPath, options } = await fixture();
  await writeFile(join(vaultPath, "alpha.md"), "alpha");
  await writeFile(join(vaultPath, "beta.md"), "beta");
  const invalidOptions = {
    ...options,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ embeddings: [[1, 0], [1]] }) }),
  };
  await assert.rejects(syncObsidian(invalidOptions), /dimens/i);
});

test("syncObsidian rejeita Ollama remoto antes de ler ou enviar notas", async () => {
  const { vaultPath, options } = await fixture();
  await writeFile(join(vaultPath, "alpha.md"), "alpha");
  let calls = 0;
  await assert.rejects(syncObsidian({
    ...options,
    ollamaUrl: "https://ollama.com",
    fetchImpl: async () => { calls += 1; throw new Error("não deveria chamar"); },
  }), /local|127\.0\.0\.1/i);
  assert.equal(calls, 0);
});

test("searchObsidian retorna evidência citável, aplica limites e valida consulta", async () => {
  const { vaultPath, options } = await fixture();
  for (let index = 0; index < 12; index += 1) {
    await writeFile(join(vaultPath, `nota-${String(index).padStart(2, "0")}.md`), `alpha nota ${index}`);
  }
  await writeFile(join(vaultPath, "beta.md"), "beta distante");
  await syncObsidian(options);

  const answer = await searchObsidian("alpha", options);
  assert.equal(answer.results.length, 5);
  assert.equal(answer.results[0].source.endsWith(".md"), true);
  assert.equal(answer.results[0].contentType, "untrusted_obsidian_note");
  assert.equal(typeof answer.results[0].modifiedAt, "string");
  assert.ok(answer.results[0].score > answer.results.at(-1).score || answer.results[0].score === 1);

  const limited = await searchObsidian("alpha", { ...options, limit: 2 });
  assert.equal(limited.results.length, 2);
  const capped = await searchObsidian("alpha", { ...options, limit: 999 });
  assert.equal(capped.results.length, 10);
  await assert.rejects(searchObsidian(" ", options), /consulta/i);
});

test("syncObsidian recusa vault fora da pasta do usuário", async () => {
  const { options } = await fixture();
  const fora = join(TEST_ROOT, "..", "vault-fora-da-home");
  await assert.rejects(
    () => syncObsidian({ ...options, vaultPath: fora }),
    /dentro da pasta do usuário/,
  );
});
