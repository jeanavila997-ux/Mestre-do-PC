// Resultado real dos comandos: envelope do PowerShell e leitura do código de saída.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  envolverComando,
  resultadoDoCodigo,
  CODIGO_SAIDA,
  RESULTADO,
  LIMITE_LINHA_COMANDO,
} from "../../v10/ps-job.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("envelope força UTF-8 e mantém o comando intacto", () => {
  const cmd = 'Stop-Service wuauserv -Force; Write-Host "✅ Cache WU limpo!" -ForegroundColor Green';
  const env = envolverComando(cmd);
  assert.match(env, /\[Console\]::OutputEncoding = \[System\.Text\.Encoding\]::UTF8/);
  assert.match(env, /\$OutputEncoding = \[System\.Text\.Encoding\]::UTF8/);
  assert.ok(env.includes(`\n${cmd}\n`), "o comando precisa entrar sem alteração");
  // UTF-8 vem antes do comando.
  assert.ok(env.indexOf("OutputEncoding") < env.indexOf(cmd));
});

test("envelope conta erros não tratados e sai com códigos distintos", () => {
  const env = envolverComando("Get-Item C:\\nao-existe");
  // Erros do fluxo 2 passam pelo contador; stderr de programa nativo não conta.
  assert.match(env, /\} 2>&1 \| ForEach-Object \{/);
  assert.match(env, /FullyQualifiedErrorId -like 'NativeCommandError\*'/);
  assert.match(env, /\$__mestreErros\+\+/);
  // Erro fatal vira falha.
  assert.match(env, /\} catch \{[\s\S]*\$__mestreErros = -1/);
  assert.ok(env.includes(`exit ${CODIGO_SAIDA.COM_ERROS}`));
  assert.ok(env.includes(`exit ${CODIGO_SAIDA.FALHOU}`));
  assert.ok(env.trimEnd().endsWith(`exit ${CODIGO_SAIDA.OK}`));
  // Código 10 do admin-tools.ps1 atravessa o envelope.
  assert.ok(env.includes(`if ($__mestreNativo -eq ${CODIGO_SAIDA.ABERTO_COMO_ADMIN}) { exit ${CODIGO_SAIDA.ABERTO_COMO_ADMIN} }`));
  // Dica de administrador só quando falta permissão e o processo não é admin.
  assert.match(env, /precisa de administrador/);
  assert.match(env, /-not \$__mestreAdmin/);
});

test("envelope cabe na linha de comando do Windows para o maior comando do catálogo", async () => {
  const catalog = JSON.parse(await readFile(join(root, "v10", "allowed-operations.json"), "utf8"));
  const todos = [...catalog.operations, ...(catalog.templates || [])];
  const maior = Math.max(...todos.map((o) => (o.command || o.pattern || "").length));
  assert.ok(envolverComando("x".repeat(maior)).length < LIMITE_LINHA_COMANDO);
  assert.ok(LIMITE_LINHA_COMANDO < 32767);
});

test("código de saída vira resultado", () => {
  assert.equal(resultadoDoCodigo(0), RESULTADO.OK);
  assert.equal(resultadoDoCodigo(3), RESULTADO.COM_ERROS);
  assert.equal(resultadoDoCodigo(1), RESULTADO.FALHOU);
  assert.equal(resultadoDoCodigo(5), RESULTADO.FALHOU);
  assert.equal(resultadoDoCodigo(null), RESULTADO.FALHOU);
  // 10 só vale como "aberto como admin" nas operações elevadas do admin-tools.ps1.
  assert.equal(resultadoDoCodigo(10, { elevado: true }), RESULTADO.ABERTO_COMO_ADMIN);
  assert.equal(resultadoDoCodigo(10), RESULTADO.FALHOU);
  assert.equal(resultadoDoCodigo(10, { elevado: false }), RESULTADO.FALHOU);
});

test("operações elevadas do catálogo passam todas pelo admin-tools.ps1", async () => {
  const catalog = JSON.parse(await readFile(join(root, "v10", "allowed-operations.json"), "utf8"));
  const elevadas = catalog.operations.filter((o) => o.elevado === true);
  assert.ok(elevadas.length > 0);
  for (const op of elevadas) assert.match(op.command, /scripts\\admin-tools\.ps1'\) -Action /, op.id);
});

test("admin-tools.ps1 sai com 10 depois de abrir a janela de administrador", async () => {
  const s = await readFile(join(root, "scripts", "admin-tools.ps1"), "utf8");
  const inicio = s.indexOf("Start-Process -FilePath 'powershell.exe' -Verb RunAs");
  assert.ok(inicio > 0);
  const bloco = s.slice(inicio, s.indexOf("} catch {", inicio));
  assert.match(bloco, /exit 10/);
  assert.doesNotMatch(bloco, /exit 0/);
});

test("launcher usa o envelope e expõe o resultado no /run-status", async () => {
  const s = await readFile(join(root, "v10", "launcher.js"), "utf8");
  assert.match(s, /from "\.\/ps-job\.js"/);
  assert.match(s, /const comando = envolverComando\(cmd\)/);
  assert.match(s, /"-Command", comando\]/);
  assert.match(s, /job\.resultado = resultadoDoCodigo\(code, \{ elevado \}\)/);
  assert.match(s, /job\.success = job\.resultado === RESULTADO\.OK/);
  assert.match(s, /resultado: job\.resultado,/);
  assert.match(s, /ps\.stdout\.setEncoding\("utf8"\)/);
});

test("painel mostra ⚠️ para comando com erros e 🛡️ para janela de admin", async () => {
  const s = await readFile(join(root, "v10", "index.html"), "utf8");
  assert.match(s, /function statusDoJob\(data\)/);
  assert.match(s, /resultado === "com_erros"\) return "aviso"/);
  assert.match(s, /resultado === "aberto_como_admin"\) return "admin"/);
  assert.match(s, /aviso: \{ icon: "⚠️"/);
  assert.match(s, /admin: \{ icon: "🛡️"/);
});
