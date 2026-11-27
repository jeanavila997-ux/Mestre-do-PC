import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import {
  buildLaunchSpec,
  clearPwshResolveCache,
  isWindowsAppsStub,
  launchConfirmedTerminal,
  mensagemFalhaAgentesCli,
  resolveShell,
  shellArgsForAgent,
} from "../../v10/terminal-launch.js";

const pwsh7 = join("C:\\Program Files", "PowerShell", "7", "pwsh.exe");
const ps51 = join("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const stub = join("C:\\Users\\Jean\\AppData\\Local\\Microsoft", "WindowsApps", "pwsh.exe");

test("resolveShell ignora o atalho de zero bytes e cai no PowerShell 5.1", () => {
  assert.equal(isWindowsAppsStub(stub), true);
  assert.equal(isWindowsAppsStub(stub, 0), true);
  assert.equal(isWindowsAppsStub(stub, 4096), false);
  const com7 = resolveShell({ ProgramFiles: "C:\\Program Files", SystemRoot: "C:\\Windows" }, (file) => file === pwsh7);
  assert.equal(com7, pwsh7);
  const sem7 = resolveShell(
    { ProgramFiles: "C:\\Program Files", SystemRoot: "C:\\Windows", MESTRE_PWSH_PATH: stub },
    (file) => file === stub || file === ps51,
  );
  assert.equal(sem7, ps51);
});

test("o plano de abertura usa wt -w new ou o shell direto, sem interpolar o pedido", () => {
  const shell = ps51;
  const cwd = "C:\\Projetos\\Mestre";
  const wt = buildLaunchSpec({ agent: "grok", shell, cwd, wtPath: "C:\\wt.exe" });
  assert.deepEqual(wt.args.slice(0, 3), ["-w", "new", "-d"]);
  assert.equal(wt.args.includes("0"), false);
  assert.equal(wt.args.at(-1), "grok");
  const conhost = buildLaunchSpec({ agent: "opencode", shell, cwd, wtPath: "" });
  assert.equal(conhost.file, shell);
  assert.deepEqual(conhost.args, ["-NoLogo", "-NoExit", "-Command", "opencode"]);
  assert.equal(shellArgsForAgent("grok; calc"), null);
  assert.equal(buildLaunchSpec({ agent: "cmd.exe /c calc", shell, cwd }).error?.includes("não permitido"), true);
});

test("sucesso só se o processo da janela continuar vivo", async () => {
  const calls = [];
  function fakeSpawn(file, args, options) {
    calls.push({ file, args, options });
    const child = new EventEmitter();
    setTimeout(() => child.emit("close", options.env.MESTRE_TERM_FORCE_EXIT), 0);
    return child;
  }
  const base = {
    agent: "grok",
    cwd: "C:\\Projetos\\Mestre",
    env: { ProgramFiles: "C:\\Program Files", SystemRoot: "C:\\Windows" },
    exists: (file) => file === ps51,
    spawnImpl: fakeSpawn,
    wtPath: "",
  };
  const morto = await launchConfirmedTerminal({ ...base, env: { ...base.env, MESTRE_TERM_FORCE_EXIT: 1 } });
  assert.equal(morto.ok, false);
  assert.match(morto.message, /fechou imediatamente/);
  const vivo = await launchConfirmedTerminal({ ...base, env: { ...base.env, MESTRE_TERM_FORCE_EXIT: 0 } });
  assert.equal(vivo.ok, true);
  const env = calls.at(-1).options.env;
  const argv = JSON.parse(env.MESTRE_TERM_ARGS);
  assert.equal(argv.includes("-w") ? argv[argv.indexOf("-w") + 1] : "shell", argv.includes("-w") ? "new" : "shell");
  assert.equal(env.MESTRE_TERM_ARGS.includes("calc"), false);
  assert.equal(calls[0].args.includes("0"), false);
});

const programFiles = "C:\\Program Files";
const localAppData = "C:\\Users\\Jean\\AppData\\Local";
const windowsApps = join(programFiles, "WindowsApps");
const store77 = join(windowsApps, "Microsoft.PowerShell_7.7.0.0_x64__8wekyb3d8bbwe", "pwsh.exe");
const store75 = join(windowsApps, "Microsoft.PowerShell_7.5.2.0_x64__8wekyb3d8bbwe", "pwsh.exe");
const store710 = join(windowsApps, "Microsoft.PowerShell_7.10.0.0_x64__8wekyb3d8bbwe", "pwsh.exe");
const baseEnv = {
  ProgramFiles: programFiles,
  SystemRoot: "C:\\Windows",
  LOCALAPPDATA: localAppData,
};

function io(overrides) {
  return {
    exists: () => false,
    statSize: () => 250_000,
    readdir: () => [],
    execFileSync: () => "",
    ...overrides,
  };
}

test("MESTRE_PWSH_PATH real, inclusive o pacote da Store, vem antes do MSI", () => {
  clearPwshResolveCache();
  assert.equal(isWindowsAppsStub(store77), false);
  assert.equal(isWindowsAppsStub(store77, 250_000), false);
  assert.equal(isWindowsAppsStub(store77, 0), true);
  const escolhido = resolveShell(
    { ...baseEnv, MESTRE_PWSH_PATH: store77 },
    io({ exists: (file) => file === store77 || file === pwsh7 || file === ps51 }),
  );
  assert.equal(escolhido, store77);
});

test("MESTRE_PWSH_PATH de zero bytes é ignorado e o MSI entra", () => {
  clearPwshResolveCache();
  const escolhido = resolveShell(
    { ...baseEnv, MESTRE_PWSH_PATH: stub },
    io({
      exists: (file) => file === stub || file === pwsh7 || file === ps51,
      statSize: (file) => (file === stub ? 0 : 250_000),
    }),
  );
  assert.equal(escolhido, pwsh7);
});

test("sem variável e sem pacote, resolve o MSI do PowerShell 7", () => {
  clearPwshResolveCache();
  const escolhido = resolveShell(baseEnv, io({ exists: (file) => file === pwsh7 || file === ps51 }));
  assert.equal(escolhido, pwsh7);
});

test("a listagem da Store escolhe o pacote x64 mais novo e ignora arm64 e arquivo vazio", () => {
  clearPwshResolveCache();
  let listed = "";
  const escolhido = resolveShell(baseEnv, io({
    exists: (file) => [store75, store77, store710, ps51].includes(file),
    statSize: (file) => (file === store710 ? 0 : 250_000),
    readdir(dir) {
      listed = dir;
      return [
        "Microsoft.PowerShell_7.5.2.0_x64__8wekyb3d8bbwe",
        "Microsoft.PowerShell_7.10.0.0_x64__8wekyb3d8bbwe",
        "Microsoft.PowerShell_7.7.0.0_x64__8wekyb3d8bbwe",
        "Microsoft.PowerShell_7.7.0.0_arm64__8wekyb3d8bbwe",
        "OutraPasta",
      ];
    },
  }));
  assert.equal(listed, windowsApps);
  assert.equal(escolhido, store77);
});

test("listagem negada consulta Get-AppxPackage uma vez e reaproveita o cache", () => {
  clearPwshResolveCache();
  const location77 = join(windowsApps, "Microsoft.PowerShell_7.7.0.0_x64__8wekyb3d8bbwe");
  const location75 = join(windowsApps, "Microsoft.PowerShell_7.5.2.0_x64__8wekyb3d8bbwe");
  const calls = [];
  const fsio = io({
    exists: (file) => file === store77 || file === ps51,
    readdir() {
      const error = new Error("Access is denied");
      error.code = "EPERM";
      throw error;
    },
    execFileSync(file, args) {
      calls.push({ file, args });
      return [
        "7.5.2.0|" + location75,
        "7.7.0.0|" + location77 + "\\",
        "",
      ].join("\n");
    },
  });
  assert.equal(resolveShell(baseEnv, fsio), store77);
  assert.equal(resolveShell(baseEnv, fsio), store77);
  assert.equal(calls.length, 1);
  assert.match(calls[0].file, /powershell\.exe$/i);
  assert.deepEqual(calls[0].args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"]);
  assert.match(calls[0].args[3], /Get-AppxPackage -Name Microsoft\.PowerShell/);
  assert.doesNotMatch(calls[0].args[3], /MESTRE_PWSH_PATH|Jean/);
});

test("o atalho do usuário só entra na consulta com stdio encadeado", () => {
  clearPwshResolveCache();
  const alias = join(localAppData, "Microsoft", "WindowsApps", "pwsh.exe");
  const fsio = io({
    exists: (file) => file === alias || file === ps51,
    statSize: (file) => (file === alias ? 0 : 250_000),
  });
  assert.equal(resolveShell(baseEnv, fsio), ps51);
  assert.equal(resolveShell(baseEnv, fsio, { allowAlias: true }), alias);
});

test("sem nenhum pwsh, o último recurso é powershell.exe", () => {
  clearPwshResolveCache();
  assert.equal(resolveShell({ ProgramFiles: programFiles }, io()), "powershell.exe");
});

test("a mensagem de falha explica como apontar o pwsh real", () => {
  assert.match(mensagemFalhaAgentesCli(ps51), /PowerShell 7 não encontrado/);
  assert.match(mensagemFalhaAgentesCli(ps51), /MESTRE_PWSH_PATH/);
  assert.match(mensagemFalhaAgentesCli(ps51), /Microsoft\.PowerShell_\*/);
  assert.match(mensagemFalhaAgentesCli(stub), /atalho de zero bytes/);
  assert.match(mensagemFalhaAgentesCli(store77), /não devolveu a lista em JSON/);
});

test("o terminal abre o binário da Store e continua sem o atalho de zero bytes", async () => {
  clearPwshResolveCache();
  const calls = [];
  function fakeSpawn(file, args, options) {
    calls.push({ file, args, options });
    const child = new EventEmitter();
    setTimeout(() => child.emit("close", 0), 0);
    return child;
  }
  const fsio = io({
    exists: (file) => file === store77 || file === stub || file === ps51,
    statSize: (file) => (file === stub ? 0 : 250_000),
    readdir: () => ["Microsoft.PowerShell_7.7.0.0_x64__8wekyb3d8bbwe"],
  });
  const aberto = await launchConfirmedTerminal({
    agent: "grok",
    cwd: "C:\\Projetos\\Mestre",
    env: baseEnv,
    io: fsio,
    spawnImpl: fakeSpawn,
    wtPath: "",
  });
  assert.equal(aberto.ok, true);
  assert.equal(calls[0].file, store77);
  assert.equal(calls[0].options.env.MESTRE_TERM_SHELL, store77);
  assert.equal(calls[0].args.includes("0"), false);

  clearPwshResolveCache();
  calls.length = 0;
  const sóAtalho = io({
    exists: (file) => file === stub || file === ps51,
    statSize: (file) => (file === stub ? 0 : 250_000),
  });
  const legado = await launchConfirmedTerminal({
    agent: "grok",
    cwd: "C:\\Projetos\\Mestre",
    env: baseEnv,
    io: sóAtalho,
    spawnImpl: fakeSpawn,
    wtPath: "",
  });
  assert.equal(legado.ok, true);
  assert.equal(calls[0].file, ps51);
  assert.equal(calls[0].options.env.MESTRE_TERM_SHELL, ps51);
});
