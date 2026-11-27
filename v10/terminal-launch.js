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

const STORE_PACKAGE_RE = /^Microsoft\.PowerShell_(\d+(?:\.\d+)*)_x64__8wekyb3d8bbwe$/i;
const APPX_QUERY = "Get-AppxPackage -Name Microsoft.PowerShell | ForEach-Object { '{0}|{1}' -f $_.Version, $_.InstallLocation }";

let appxPwshCache;

export function clearPwshResolveCache() {
  appxPwshCache = undefined;
}

function normalizeIo(io) {
  if (typeof io === "function") {
    return { exists: io, statSize: () => undefined, readdir: null, execFileSync: null };
  }
  const src = io || {};
  return {
    exists: typeof src.exists === "function" ? src.exists : () => false,
    statSize: typeof src.statSize === "function" ? src.statSize : () => undefined,
    readdir: typeof src.readdir === "function" ? src.readdir : null,
    execFileSync: typeof src.execFileSync === "function" ? src.execFileSync : null,
  };
}

function safeSize(io, file) {
  try {
    const size = io.statSize(file);
    return typeof size === "number" ? size : undefined;
  } catch {
    return undefined;
  }
}

function compareVersionDesc(left, right) {
  const a = String(left || "").split(".").map((part) => Number(part) || 0);
  const b = String(right || "").split(".").map((part) => Number(part) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (b[i] || 0) - (a[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function powershell51Path(env) {
  const root = env.SystemRoot || env.WINDIR;
  if (root) return join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return "powershell.exe";
}

function userAliasPath(env) {
  if (!env.LOCALAPPDATA) return "";
  return join(env.LOCALAPPDATA, "Microsoft", "WindowsApps", "pwsh.exe");
}

export function isWindowsAppsStub(filePath, size) {
  const value = String(filePath || "");
  if (!/[/\\]WindowsApps[/\\]/i.test(value)) return false;
  if (typeof size === "number") return size === 0;
  if (/[/\\]Microsoft\.PowerShell_[^/\\]+[/\\]pwsh\.exe$/i.test(value)) return false;
  return /[/\\]WindowsApps[/\\]pwsh\.exe$/i.test(value);
}

function isRealPwsh(file, io) {
  if (!file || !io.exists(file)) return false;
  if (!/[/\\]pwsh\.exe$/i.test(file) && !/^pwsh\.exe$/i.test(file)) return false;
  const size = safeSize(io, file);
  if (typeof size === "number" && size === 0) return false;
  return !isWindowsAppsStub(file, size);
}

function storePackageVersion(name) {
  const match = String(name).match(STORE_PACKAGE_RE);
  return match ? match[1] : "";
}

function newestRealPackage(names, dir, io) {
  const packages = (names || [])
    .filter((name) => storePackageVersion(name))
    .sort((left, right) => compareVersionDesc(storePackageVersion(left), storePackageVersion(right)));
  for (const name of packages) {
    const exe = join(dir, name, "pwsh.exe");
    if (isRealPwsh(exe, io)) return exe;
  }
  return "";
}

function queryStorePackage(env, io) {
  if (appxPwshCache !== undefined) return appxPwshCache || "";
  if (!io.execFileSync) return "";
  let stdout = "";
  try {
    stdout = io.execFileSync(powershell51Path(env), ["-NoProfile", "-NonInteractive", "-Command", APPX_QUERY], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20000,
    });
  } catch {
    appxPwshCache = null;
    return "";
  }
  const found = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .flatMap((line) => {
      const sep = line.indexOf("|");
      if (sep <= 0) return [];
      const version = line.slice(0, sep).trim();
      const location = line.slice(sep + 1).trim().replace(/[/\\]+$/, "");
      if (!version || !location) return [];
      return [{ version, exe: join(location, "pwsh.exe") }];
    })
    .sort((left, right) => compareVersionDesc(left.version, right.version));
  const exe = found.find((item) => isRealPwsh(item.exe, io))?.exe || "";
  appxPwshCache = exe || null;
  return exe;
}

function findStorePackagePwsh(env, io) {
  if (!io.readdir) return "";
  const dir = join(env.ProgramFiles || "C:\\Program Files", "WindowsApps");
  try {
    return newestRealPackage(io.readdir(dir) || [], dir, io);
  } catch {
    return queryStorePackage(env, io);
  }
}

export function mensagemFalhaAgentesCli(shell) {
  const caminho = String(shell || "");
  const alias = isWindowsAppsStub(caminho) || /[/\\]Microsoft[/\\]WindowsApps[/\\]pwsh\.exe$/i.test(caminho);
  const ePwsh7 = (/[/\\]pwsh\.exe$/i.test(caminho) || /^pwsh\.exe$/i.test(caminho)) && !alias;
  if (!ePwsh7) {
    return "PowerShell 7 não encontrado e o Windows PowerShell 5.1 não devolveu a lista de agentes. Instale o pwsh 7 (winget install --id Microsoft.PowerShell -e, ou pela Microsoft Store) ou defina MESTRE_PWSH_PATH com o pwsh.exe real. No pacote da Store o executável é C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_*_x64__8wekyb3d8bbwe\\pwsh.exe. O atalho de zero bytes em %LOCALAPPDATA%\\Microsoft\\WindowsApps\\pwsh.exe não abre o terminal. Reinicie o launcher depois de instalar ou ajustar a variável.";
  }
  return "Falha ao consultar os agentes CLI. O pwsh 7 iniciou, mas não devolveu a lista em JSON. No projeto, rode: pwsh -NoProfile -File scripts\\cli-agents.ps1 -Action status-json";
}

export function resolveShell(env = process.env, io = () => false, options = {}) {
  const fsio = normalizeIo(io);
  const programFiles = env.ProgramFiles || "C:\\Program Files";
  if (isRealPwsh(env.MESTRE_PWSH_PATH, fsio)) return env.MESTRE_PWSH_PATH;
  const msi = join(programFiles, "PowerShell", "7", "pwsh.exe");
  if (isRealPwsh(msi, fsio)) return msi;
  const store = findStorePackagePwsh(env, fsio);
  if (store) return store;
  if (options.allowAlias) {
    const alias = userAliasPath(env);
    if (alias && fsio.exists(alias)) return alias;
  }
  const powershell51 = powershell51Path(env);
  if (env.SystemRoot || env.WINDIR) {
    if (fsio.exists(powershell51)) return powershell51;
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

export function launchConfirmedTerminal({ agent, cwd, env, exists, spawnImpl, scriptPath, wtPath, io }) {
  const fsio = io || exists || (() => false);
  const existsFn = typeof fsio === "function" ? fsio : (fsio.exists || (() => false));
  const shell = resolveShell(env, fsio, { allowAlias: false });
  const spec = buildLaunchSpec({
    agent,
    shell,
    cwd,
    scriptPath,
    wtPath: wtPath ?? resolveWindowsTerminal(env, existsFn),
  });
  if (spec.error) return Promise.resolve({ ok: false, message: spec.error });
  const checker = resolveShell(env, fsio, { allowAlias: false });
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
