import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import {
  buildLaunchSpec,
  isWindowsAppsStub,
  launchConfirmedTerminal,
  resolveShell,
  shellArgsForAgent,
} from "../../v10/terminal-launch.js";

const pwsh7 = join("C:\\Program Files", "PowerShell", "7", "pwsh.exe");
const ps51 = join("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const stub = join("C:\\Users\\Jean\\AppData\\Local\\Microsoft", "WindowsApps", "pwsh.exe");

test("resolveShell ignora o atalho da Store e cai no PowerShell 5.1", () => {
  assert.equal(isWindowsAppsStub(stub), true);
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
