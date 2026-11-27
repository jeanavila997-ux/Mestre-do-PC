import { join } from "node:path";

const AGENT_ARGV = {
  claude: ["claude"],
  opencode: ["opencode"],
  codex: ["codex"],
  gemini: ["gemini"],
  qwen: ["qwen"],
  aider: ["aider"],
  copilot: ["copilot"],
  cursor: ["cursor-agent"],
  grok: ["grok"],
  dsh: ["dsh"],
  hermes: ["hermes"],
  goose: ["goose", "session"],
  kilo: ["kilo"],
  cline: ["cline"],
  crush: ["crush"],
  pi: ["pi"],
  antigravity: ["agy"],
  ori: ["ori", "code"],
  openhands: ["openhands"],
  interpreter: ["interpreter"],
  continue: ["cn"],
  plandex: ["plandex"],
  kimi: ["kimi"],
  gptme: ["gptme"],
  kiro: ["kiro-cli"],
  amp: ["amp"],
  droid: ["droid"],
  omp: ["omp", "--model", "qwen2.5-coder:3b-instruct"],
};

const CONFIRM_SCRIPT = `
$argList = @()
if ($env:MESTRE_TERM_ARGS) {
  foreach ($item in @(ConvertFrom-Json -InputObject $env:MESTRE_TERM_ARGS)) { $argList += [string]$item }
}
$params = @{ FilePath = $env:MESTRE_TERM_SHELL; WorkingDirectory = $env:MESTRE_TERM_CWD; WindowStyle = 'Normal'; PassThru = $true }
if ($argList.Count -gt 0) { $params.ArgumentList = $argList }
$p = Start-Process @params
Start-Sleep -Milliseconds 1500
if (-not $p -or $p.HasExited) { exit 1 }
exit 0
`;

export function isWindowsAppsStub(filePath) {
  return /[/\\]WindowsApps[/\\]/i.test(String(filePath || ""));
}

export function resolveShell(env = process.env, exists = () => false) {
  const programFiles = env.ProgramFiles || "C:\\Program Files";
  const candidates = [
    env.MESTRE_PWSH_PATH,
    join(programFiles, "PowerShell", "7", "pwsh.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (exists(candidate) && !isWindowsAppsStub(candidate)) return candidate;
  }
  const root = env.SystemRoot || env.WINDIR;
  if (root) {
    const powershell51 = join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    if (exists(powershell51)) return powershell51;
  }
  return "powershell.exe";
}

export function resolveWindowsTerminal(env = process.env, exists = () => false) {
  if (env.MESTRE_WT_PATH && exists(env.MESTRE_WT_PATH)) return env.MESTRE_WT_PATH;
  if (env.LOCALAPPDATA) {
    const alias = join(env.LOCALAPPDATA, "Microsoft", "WindowsApps", "wt.exe");
    if (exists(alias)) return alias;
  }
  return "";
}

export function shellArgsForAgent(agent, scriptPath) {
  if (!/^[a-z0-9]+$/.test(agent)) return null;
  if (agent === "pwsh") return ["-NoLogo", "-NoExit"];
  if (agent === "llamacpp") {
    if (!scriptPath) return null;
    return ["-NoLogo", "-NoExit", "-File", scriptPath, "-Action", "llamacpp-status"];
  }
  const argv = AGENT_ARGV[agent];
  if (!argv) return null;
  return ["-NoLogo", "-NoExit", "-Command", argv.join(" ")];
}

export function buildLaunchSpec({ agent, shell, cwd, wtPath, scriptPath }) {
  const shellArgs = shellArgsForAgent(agent, scriptPath);
  if (!shellArgs || !shell || !cwd) {
    return { error: "Agente de terminal não permitido: " + String(agent || "") };
  }
  if (wtPath) {
    return {
      file: wtPath,
      args: ["-w", "new", "-d", cwd, "--", shell, ...shellArgs],
    };
  }
  return { file: shell, args: shellArgs };
}

export function launchConfirmedTerminal({ agent, cwd, env, exists, spawnImpl, scriptPath, wtPath }) {
  const shell = resolveShell(env, exists);
  const spec = buildLaunchSpec({
    agent,
    shell,
    cwd,
    scriptPath,
    wtPath: wtPath ?? resolveWindowsTerminal(env, exists),
  });
  if (spec.error) return Promise.resolve({ ok: false, message: spec.error });
  const checker = resolveShell({ ...env, MESTRE_PWSH_PATH: "" }, (file) => {
    if (file === env.MESTRE_PWSH_PATH) return false;
    return exists(file);
  });
  return new Promise((resolvePromise) => {
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    let child;
    try {
      child = spawnImpl(checker, ["-NoProfile", "-Command", CONFIRM_SCRIPT], {
        windowsHide: true,
        env: {
          ...env,
          MESTRE_TERM_SHELL: spec.file,
          MESTRE_TERM_ARGS: JSON.stringify(spec.args),
          MESTRE_TERM_CWD: cwd,
        },
      });
    } catch (error) {
      finish({ ok: false, message: "Não foi possível abrir o terminal: " + error.message });
      return;
    }
    timer = setTimeout(() => {
      try { child.kill(); } catch { /* processo já saiu */ }
      finish({ ok: false, message: "O terminal não permaneceu aberto. Confira se o agente está instalado." });
    }, 8000);
    child.on("error", () => finish({ ok: false, message: "Não foi possível abrir uma janela de terminal neste PC." }));
    child.on("close", (code) => {
      if (code === 0) finish({ ok: true, message: "Terminal aberto: " + agent });
      else finish({ ok: false, message: "O terminal fechou imediatamente. Confira se o agente está instalado." });
    });
  });
}
