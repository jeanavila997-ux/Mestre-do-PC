import test from "node:test";
import "./helpers/launcher-test-env.js";
import { dashboardHeaders } from "./helpers/dashboard-session.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));

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

test("salvar perfil exige sessão, valida o nome e mostra a Transcrição", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "mestre-perfil-api-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const port = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(root, "v10", "launcher.js")], {
    cwd: join(root, "v10"),
    env: {
      ...process.env,
      MPC_PORT: String(port),
      MESTRE_PROFILE_OVERRIDES_PATH: join(dir, "overrides.json"),
    },
    windowsHide: true,
    stdio: "ignore",
  });
  t.after(() => child.kill());
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(base + "/ping")).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const anon = await fetch(base + "/api/model-profiles/fast", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Mestre-Client": "v10-web" },
    body: JSON.stringify({ model: "qwen2.5-coder:7b" }),
  });
  assert.equal(anon.status, 403);

  const headers = await dashboardHeaders(base);
  const ruim = await fetch(base + "/api/model-profiles/fast", {
    method: "PUT",
    headers,
    body: JSON.stringify({ model: "modelo com espaço" }),
  });
  assert.equal(ruim.status, 400);

  const ok = await fetch(base + "/api/model-profiles/transcription", {
    method: "PUT",
    headers,
    body: JSON.stringify({ model: "dimavz/whisper-tiny:latest" }),
  });
  assert.equal(ok.status, 200);
  const salvo = await ok.json();
  assert.equal(salvo.success, true);
  assert.equal(salvo.model, "dimavz/whisper-tiny:latest");

  const lista = await fetch(base + "/api/model-profiles", { headers });
  const perfis = (await lista.json()).perfis;
  const transcricao = perfis.find((item) => item.id === "transcription");
  assert.ok(transcricao, "perfil Transcrição precisa existir");
  assert.equal(transcricao.label, "Transcrição");
  assert.ok(transcricao.model, "Transcrição não pode aparecer sem modelo");
  assert.ok(transcricao.description);

  const restaurado = await fetch(base + "/api/model-profiles/transcription/restaurar", {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(restaurado.status, 200);
  assert.ok((await restaurado.json()).model);
});
