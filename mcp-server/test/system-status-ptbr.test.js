// mestre_system_status em pt-BR: campos rotulados e já formatados, para o
// modelo local não precisar converter nada (e "cpu" deixa de ser ambíguo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSystemStatusPtBr, formatUptimePtBr } from "../../v10/chat-integrado/system-status-format.js";

const bruto = { cpu: 1, cpuCount: 12, ramFree: 4.5, ramTotal: 15.78, diskFree: 270.23, diskUsed: 205.37, uptimeSec: 11383 };

test("tempo ligado formatado em horas e minutos", () => {
  assert.equal(formatUptimePtBr(11383), "3h 09min");
  assert.equal(formatUptimePtBr(59), "0h 00min");
  assert.equal(formatUptimePtBr(3 * 86400 + 3600 + 5 * 60), "3d 1h 05min");
});

test("campos rotulados e calculados, sem o campo ambíguo cpu no topo", () => {
  const r = formatSystemStatusPtBr(bruto);
  assert.equal(r.processadores_logicos, 12);
  assert.equal(r.uso_cpu_pct, 1);
  assert.equal(r.ram_total_gb, 15.78);
  assert.equal(r.ram_livre_gb, 4.5);
  assert.equal(r.ram_usada_gb, 11.28);
  assert.equal(r.ram_uso_pct, 71.5);
  assert.equal(r.disco_livre_gb, 270.23);
  assert.equal(r.disco_usado_gb, 205.37);
  assert.equal(r.disco_total_gb, 475.6);
  assert.equal(r.tempo_ligado, "3h 09min");
  assert.equal(r.tempo_ligado_seg, 11383);
  assert.equal("cpu" in r, false);
  assert.match(r.resumo, /CPU 1% de uso em 12 processadores lógicos/);
  assert.match(r.resumo, /RAM 4,5 GB livres de 15,78 GB/);
  assert.match(r.resumo, /disco C: 270,23 GB livres de 475,6 GB/);
  assert.match(r.resumo, /ligado há 3h 09min/);
});

test("compatibilidade: campos antigos continuam em bruto", () => {
  const r = formatSystemStatusPtBr(bruto);
  assert.deepEqual(r.bruto, bruto);
});

test("sem coleta (Mestre sem PowerShell): avisa em vez de inventar", () => {
  const r = formatSystemStatusPtBr({ cpu: 0, ramFree: 0, ramTotal: 0, diskFree: 0, diskUsed: 0, uptimeSec: 0 });
  assert.equal(r.disponivel, false);
  assert.match(r.resumo, /não foi possível/i);
  assert.equal(r.processadores_logicos, null);
});

test("launcher coleta a contagem de processadores e o MCP usa o formato pt-BR", async () => {
  const fs = await import("node:fs");
  const launcher = fs.readFileSync(new URL("../../v10/launcher.js", import.meta.url), "utf8");
  assert.match(launcher, /NumberOfLogicalProcessors/);
  assert.match(launcher, /cpuCount=\$cpuCount/);
  const bridge = fs.readFileSync(new URL("../../v10/chat-integrado/grokbot-bridge.js", import.meta.url), "utf8");
  assert.match(bridge, /return formatSystemStatusPtBr\(await getQuickSystemMetrics\(\)\)/);
});
