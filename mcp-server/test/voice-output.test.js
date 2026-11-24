import test from "node:test";
import assert from "node:assert/strict";
import { playKokoro, authorizeKokoroOnce } from "../../v10/chat-integrado/voice-output.js";

test("botão Kokoro solicita WAV autenticado e reproduz após a ação do usuário", async () => {
  let request;
  let played = false;
  const audio = { play: async () => { played = true; } };
  const result = await playKokoro("Olá, Jean", {
    fetchImpl: async (path, init) => {
      request = { path, init };
      return { ok: true, status: 200, blob: async () => new Blob(["wav"], { type: "audio/wav" }) };
    },
    createObjectURL: () => "blob:teste",
    createAudio: () => audio,
  });
  assert.equal(request.path, "/api/voice/kokoro");
  assert.equal(request.init.headers["X-Mestre-Client"], "v10-web");
  assert.equal(JSON.parse(request.init.body).text, "Olá, Jean");
  assert.equal(played, true);
  assert.equal(result.url, "blob:teste");
});

test("botão Kokoro não reproduz nem expõe corpo quando a rota falha", async () => {
  let played = false;
  await assert.rejects(playKokoro("Teste", {
    fetchImpl: async () => ({ ok: false, status: 502, text: async () => "detalhe interno" }),
    createObjectURL: () => "blob:teste",
    createAudio: () => ({ play: async () => { played = true; } }),
  }), /502|Voicebox|Kokoro/);
  assert.equal(played, false);
});

test("download do Kokoro exige consentimento uma única vez", async () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  let confirmations = 0;
  const confirm = async () => { confirmations += 1; return true; };
  assert.equal(await authorizeKokoroOnce({ storage, confirm }), true);
  assert.equal(await authorizeKokoroOnce({ storage, confirm }), true);
  assert.equal(confirmations, 1);
  const denied = { getItem: () => null, setItem: () => { throw new Error("não gravar"); } };
  assert.equal(await authorizeKokoroOnce({ storage: denied, confirm: async () => false }), false);
});
