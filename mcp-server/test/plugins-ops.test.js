// Contrato da sessão Plugins e dos novos comandos de diagnóstico (hardware, energia, segurança).
import test from "node:test";
import assert from "node:assert/strict";
import { loadOperationRegistry, clearOperationRegistryCache } from "../../v10/operation-registry.js";

const NOVOS_IDS = [
  "plugins_vscode_listar", "plugins_vscode_exportar", "plugins_notepadpp_listar",
  "plugins_chrome_listar", "plugins_edge_listar", "plugins_firefox_listar",
  "plugins_powershell_atualizar", "plugins_mcp_listar", "plugins_ollama_modelos_tamanho",
  "bluetooth_dispositivos", "usb_dispositivos", "impressoras_listar", "monitores_info",
  "wifi_relatorio", "energia_relatorio", "energia_sleepstudy", "ativacao_windows_status",
  "bsod_ultimos_crashes", "tpm_secureboot_status", "defender_ameacas_detectadas",
  "volumes_listar", "sombras_vss_listar",
];

async function registro() {
  clearOperationRegistryCache();
  return loadOperationRegistry();
}

test("a categoria Plugins existe e o registro continua íntegro", async () => {
  const reg = await registro();
  assert.ok(reg.operations.some((o) => o.category === "Plugins"), "categoria Plugins ausente");
  const v = reg.validate();
  assert.ok(v.ok, `validate() falhou: ${JSON.stringify(v.errors)}`);
});

test("os novos comandos resolvem por id", async () => {
  const reg = await registro();
  for (const id of NOVOS_IDS) {
    const r = reg.resolve({ id });
    assert.ok(r.cmd && !r.error, `operação ${id} não resolveu: ${r.error}`);
  }
});

test("só a atualização de módulos PowerShell é destrutiva", async () => {
  const reg = await registro();
  const byId = new Map(reg.operations.map((o) => [o.id, o]));
  for (const id of NOVOS_IDS) {
    const esperado = id === "plugins_powershell_atualizar";
    assert.equal(byId.get(id).destructive, esperado, `destructive incorreto em ${id}`);
  }
});

test("plugins_mcp_listar não expõe env nem tokens das configs", async () => {
  const reg = await registro();
  const cmd = reg.resolve({ id: "plugins_mcp_listar" }).cmd;
  assert.doesNotMatch(cmd, /\.env\b|\btoken\b|apiKey/i);
});
