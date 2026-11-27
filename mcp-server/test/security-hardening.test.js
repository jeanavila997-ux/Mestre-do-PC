import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateWebhookUrl, assertPublicWebhookUrl, isPrivateAddress } from "../security/webhook-url.js";
import { resolveTablePath } from "../security/table-path.js";
import { analisarPrintInvocation, ANALISAR_PRINT_SCRIPT } from "../security/visual-script.js";
import { validateModelName, saveProfileOverride, resetProfileOverride, listEffectiveProfiles } from "../../v10/model-profile-overrides.js";

test("webhook recusa http, IP interno e host fora da lista", () => {
  assert.equal(validateWebhookUrl("http://discord.com/api/webhooks/1").ok, false);
  assert.equal(validateWebhookUrl("https://127.0.0.1/hook").ok, false);
  assert.equal(validateWebhookUrl("https://evil.example/hook").ok, false);
  assert.equal(validateWebhookUrl("https://discord.com/api/webhooks/1").ok, true);
  assert.equal(isPrivateAddress("10.1.2.3"), true);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
});

test("webhook recusa DNS que aponta para rede interna", async () => {
  const blocked = await assertPublicWebhookUrl("https://hooks.slack.com/services/T/B/X", async () => [{ address: "127.0.0.1" }]);
  assert.equal(blocked.ok, false);
  const ok = await assertPublicWebhookUrl("https://hooks.slack.com/services/T/B/X", async () => [{ address: "1.2.3.4" }]);
  assert.equal(ok.ok, true);
});

test("nome de tabela não escapa do diretório", () => {
  const dir = "/tmp/tabelas";
  assert.equal(resolveTablePath(dir, "../segredo").ok, false);
  assert.equal(resolveTablePath(dir, "..\\segredo.csv").ok, false);
  assert.equal(resolveTablePath(dir, "final.csv").ok, true);
  assert.match(resolveTablePath(dir, "final").filePath, /final\.csv$/);
});

test("analisar_print não interpola contexto no fonte Python", () => {
  const payload = '"); import os; os.system("calc"); ("';
  const invocation = analisarPrintInvocation("python", "C:/print.png", payload);
  assert.equal(invocation.args[3], payload);
  assert.equal(invocation.args[2].includes(payload), false);
  assert.equal(ANALISAR_PRINT_SCRIPT.includes(payload), false);
  assert.match(ANALISAR_PRINT_SCRIPT, /sys\.argv\[2\]/);
});

test("nome de modelo aceita tag cloud e recusa comando", () => {
  assert.equal(validateModelName("kimi-k2.7-code:cloud").ok, true);
  assert.equal(validateModelName("fazendaavila2026/agente:latest").ok, true);
  assert.equal(validateModelName("qwen; rm -rf").ok, false);
  assert.equal(validateModelName("").ok, false);
});

test("override de perfil grava fora do JSON versionado e restaura o padrão", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mestre-perfis-"));
  const previous = process.env.MESTRE_PROFILE_OVERRIDES_PATH;
  process.env.MESTRE_PROFILE_OVERRIDES_PATH = join(dir, "overrides.json");
  try {
    const saved = saveProfileOverride("transcription", "whisper-custom:latest");
    assert.equal(saved.ok, true);
    const listed = listEffectiveProfiles().find((item) => item.id === "transcription");
    assert.equal(listed.model, "whisper-custom:latest");
    assert.equal(listed.overridden, true);
    assert.ok(listed.defaultModel);
    const restored = resetProfileOverride("transcription");
    assert.equal(restored.model, listed.defaultModel);
    assert.notEqual(listed.defaultModel, "");
  } finally {
    if (previous === undefined) delete process.env.MESTRE_PROFILE_OVERRIDES_PATH;
    else process.env.MESTRE_PROFILE_OVERRIDES_PATH = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
