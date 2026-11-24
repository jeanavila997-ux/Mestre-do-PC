import test from "node:test";
import assert from "node:assert/strict";
import { generateKokoroSpeech, prepareSpeechText } from "../../v10/chat-integrado/kokoro-voice.js";

test("prepareSpeechText remove Markdown/código e limita a síntese", () => {
  const input = "**Olá** [Jean](https://example.com)\n```powershell\nWrite-Host segredo\n```\nTexto final";
  const prepared = prepareSpeechText(input);
  assert.doesNotMatch(prepared, /Write-Host|```|\*\*|example\.com/);
  assert.match(prepared, /Olá/);
  assert.match(prepared, /Jean/);
  assert.match(prepared, /Texto final/);
  assert.equal(prepareSpeechText("a".repeat(5000)).length, 4000);
  assert.throws(() => prepareSpeechText("```js\ncodigo\n```"), /texto/i);
});

test("Kokoro usa perfil Dora existente e devolve WAV", async () => {
  const calls = [];
  const result = await generateKokoroSpeech("Olá, Jean", {
    baseUrl: "http://127.0.0.1:17493",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith("/profiles") && !init.method) {
        return { ok: true, status: 200, json: async () => [{ id: "perfil-dora", name: "Dora", default_engine: "kokoro", language: "pt" }] };
      }
      if (url.endsWith("/generate/stream")) {
        return { ok: true, status: 200, headers: { get: () => "audio/wav" }, arrayBuffer: async () => new TextEncoder().encode("RIFF-teste").buffer };
      }
      throw new Error("rota inesperada");
    },
  });
  assert.equal(result.contentType, "audio/wav");
  assert.equal(Buffer.from(result.audio).toString(), "RIFF-teste");
  const generation = calls.find((call) => call.url.endsWith("/generate/stream"));
  const body = JSON.parse(generation.init.body);
  assert.equal(body.profile_id, "perfil-dora");
  assert.equal(body.engine, "kokoro");
  assert.equal(body.language, "pt");
});

test("Kokoro cria o perfil local somente quando necessário", async () => {
  const calls = [];
  await generateKokoroSpeech("Teste", {
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith("/profiles") && !init.method) return { ok: true, status: 200, json: async () => [] };
      if (url.endsWith("/profiles") && init.method === "POST") return { ok: true, status: 201, json: async () => ({ id: "novo-perfil" }) };
      if (url.endsWith("/generate/stream")) return { ok: true, status: 200, headers: { get: () => "audio/x-wav" }, arrayBuffer: async () => new Uint8Array([1, 2]).buffer };
      throw new Error("rota inesperada");
    },
  });
  const creation = calls.find((call) => call.url.endsWith("/profiles") && call.init.method === "POST");
  const body = JSON.parse(creation.init.body);
  assert.equal(body.preset_engine, "kokoro");
  assert.equal(body.preset_voice_id, "pf_dora");
});

test("Kokoro recusa endpoint remoto e não propaga corpo de erro", async () => {
  let calls = 0;
  await assert.rejects(generateKokoroSpeech("Teste", {
    baseUrl: "https://voicebox.example.com",
    fetchImpl: async () => { calls += 1; throw new Error("não chamar"); },
  }), /local|127\.0\.0\.1/i);
  assert.equal(calls, 0);
  await assert.rejects(generateKokoroSpeech("Teste", {
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => "detalhe interno" }),
  }), /Voicebox.*500/);
});
