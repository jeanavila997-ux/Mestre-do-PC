#Requires -Version 5.1
<#
.SYNOPSIS
  Status e lançamento de agentes CLI no terminal do Mestre do PC.

  status-json também roda no Windows PowerShell 5.1: devolve a lista sem a
  sonda de versão em paralelo (isso é exclusivo do pwsh 7). O restante do
  script prefere o pwsh 7 quando ele existe.

.DESCRIPTION
  Catálogo único ($Agentes): cada agente tem detecção (se está instalado), versão,
  comando para abrir e link de instalação. O menu NUNCA instala nada sozinho: agente
  ausente devolve o link oficial para o usuário instalar se quiser.

.EXAMPLE
  pwsh -NoProfile -File .\scripts\cli-agents.ps1 -Action status
  pwsh -NoProfile -File .\scripts\cli-agents.ps1 -Action status-json
  pwsh -NoProfile -File .\scripts\cli-agents.ps1 -Action opencode
#>
param(
  [Parameter(Mandatory)]
  [ValidateSet(
    'status',
    'status-json',
    'install-opencode',
    'llamacpp-status',
    'claude', 'opencode', 'codex', 'gemini', 'qwen', 'aider', 'copilot', 'cursor',
    'grok', 'dsh', 'hermes', 'goose', 'kilo', 'cline', 'crush', 'pi',
    'antigravity', 'ori', 'openhands', 'interpreter', 'continue', 'plandex', 'kimi', 'gptme', 'kiro', 'amp', 'droid', 'omp'
  )]
  [string] $Action
)

$ErrorActionPreference = 'Continue'
$Project = if ($env:MESTRE_PROJETO_PATH) { $env:MESTRE_PROJETO_PATH } else {
  Split-Path -Parent (Split-Path -Parent $PSCommandPath)
}

# id = nome da ação/rota; cmds = executáveis procurados (em ordem); abrir = linha de comando no terminal.
$Agentes = @(
  [ordered]@{ id = 'claude';   nome = 'Claude Code';        cmds = @('claude');                 abrir = 'claude';   instalar = 'https://github.com/anthropics/claude-code' }
  [ordered]@{ id = 'opencode'; nome = 'OpenCode';           cmds = @('opencode');               abrir = 'opencode'; instalar = 'https://github.com/anomalyco/opencode' }
  [ordered]@{ id = 'codex';    nome = 'Codex CLI (OpenAI)'; cmds = @('codex');                  abrir = 'codex';    instalar = 'https://github.com/openai/codex' }
  [ordered]@{ id = 'gemini';   nome = 'Gemini CLI';         cmds = @('gemini');                 abrir = 'gemini';   instalar = 'https://github.com/google-gemini/gemini-cli' }
  [ordered]@{ id = 'qwen';     nome = 'Qwen Code';          cmds = @('qwen');                   abrir = 'qwen';     instalar = 'https://github.com/QwenLM/qwen-code' }
  [ordered]@{ id = 'aider';    nome = 'Aider';              cmds = @('aider');                  abrir = 'aider';    instalar = 'https://github.com/Aider-AI/aider' }
  [ordered]@{ id = 'copilot';  nome = 'GitHub Copilot CLI'; cmds = @('copilot');                abrir = 'copilot';  instalar = 'https://github.com/github/copilot-cli' }
  [ordered]@{ id = 'cursor';   nome = 'Cursor Agent';       cmds = @('cursor-agent');           abrir = 'cursor-agent'; instalar = 'https://cursor.com/cli' }
  [ordered]@{ id = 'grok';     nome = 'Grok CLI';           cmds = @('grok');                   abrir = 'grok';     instalar = 'https://github.com/xai-org/grok-build' }
  [ordered]@{ id = 'dsh';      nome = 'DeepSeek Harness (dsh)'; cmds = @('dsh');                abrir = 'dsh';      instalar = 'https://github.com/deepseek-ai/deepseek-harness' }
  [ordered]@{ id = 'hermes';   nome = 'Hermes Agent';       cmds = @('hermes');                 abrir = 'hermes';   instalar = 'https://github.com/NousResearch/hermes-agent' }
  [ordered]@{ id = 'goose';    nome = 'Goose';              cmds = @('goose');                  abrir = 'goose session'; instalar = 'https://github.com/aaif-goose/goose' }
  [ordered]@{ id = 'kilo';     nome = 'Kilo Code CLI';      cmds = @('kilo', 'kilocode');       abrir = 'kilo'; instalar = 'https://github.com/Kilo-Org/kilocode' }
  [ordered]@{ id = 'cline';    nome = 'Cline CLI';          cmds = @('cline');                  abrir = 'cline';    instalar = 'https://github.com/cline/cline' }
  [ordered]@{ id = 'crush';    nome = 'Crush (Charm)';      cmds = @('crush');                  abrir = 'crush';    instalar = 'https://github.com/charmbracelet/crush' }
  [ordered]@{ id = 'pi';       nome = 'Pi Coding Agent';    cmds = @('pi');                     abrir = 'pi';       instalar = 'https://github.com/earendil-works/pi' }
  [ordered]@{ id = 'antigravity'; nome = 'Antigravity CLI (agy)'; cmds = @('agy'); abrir = 'agy'; instalar = 'https://github.com/google-antigravity/antigravity-cli' }
  [ordered]@{ id = 'ori'; nome = 'Ori (OpenRouter)'; cmds = @('ori'); abrir = 'ori code'; instalar = 'https://github.com/OpenRouterLabs/ori-releases' }
  [ordered]@{ id = 'openhands'; nome = 'OpenHands'; cmds = @('openhands'); abrir = 'openhands'; instalar = 'https://github.com/OpenHands/OpenHands' }
  [ordered]@{ id = 'interpreter'; nome = 'Open Interpreter'; cmds = @('interpreter'); abrir = 'interpreter'; instalar = 'https://github.com/openinterpreter/openinterpreter' }
  [ordered]@{ id = 'continue'; nome = 'Continue CLI (cn)'; cmds = @('cn'); abrir = 'cn'; instalar = 'https://github.com/continuedev/continue' }
  [ordered]@{ id = 'plandex'; nome = 'Plandex'; cmds = @('plandex'); abrir = 'plandex'; instalar = 'https://github.com/plandex-ai/plandex' }
  [ordered]@{ id = 'kimi'; nome = 'Kimi Code'; cmds = @('kimi'); abrir = 'kimi'; instalar = 'https://github.com/MoonshotAI/kimi-code' }
  [ordered]@{ id = 'gptme'; nome = 'gptme'; cmds = @('gptme'); abrir = 'gptme'; instalar = 'https://github.com/gptme/gptme' }
  [ordered]@{ id = 'kiro'; nome = 'Kiro CLI'; cmds = @('kiro-cli'); abrir = 'kiro-cli'; instalar = 'https://github.com/kirodotdev/Kiro' }
  [ordered]@{ id = 'amp'; nome = 'Amp'; cmds = @('amp'); abrir = 'amp'; instalar = 'https://ampcode.com' }
  [ordered]@{ id = 'droid'; nome = 'Droid (Factory)'; cmds = @('droid'); abrir = 'droid'; instalar = 'https://github.com/Factory-AI/factory' }
  [ordered]@{ id = 'omp';      nome = 'OMP';                cmds = @('omp');                    abrir = 'omp --model qwen2.5-coder:3b-instruct'; instalar = '' }
)

function Find-Cmd([string]$Name) {
  $c = Get-Command $Name -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return $c.Source }
  $guess = @(
    (Join-Path $env:USERPROFILE ".opencode\bin\$Name.exe"),
    (Join-Path $env:APPDATA "npm\$Name.ps1"),
    (Join-Path $env:APPDATA "npm\$Name.cmd"),
    (Join-Path $env:LOCALAPPDATA "omp\$Name.exe"),
    (Join-Path $env:LOCALAPPDATA "omp\bin\$Name.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\OpenAI\Codex\bin\$Name.exe"),
    (Join-Path $env:LOCALAPPDATA "cursor-agent\$Name.ps1"),
    (Join-Path $env:USERPROFILE ".grok\bin\$Name.exe"),
    (Join-Path $env:USERPROFILE ".local\bin\$Name.exe")
  )
  foreach ($g in $guess) { if (Test-Path -LiteralPath $g) { return $g } }
  return $null
}

function Get-AgentStatus {
  $base = foreach ($a in $Agentes) {
    $path = $null; $cmd = $null
    foreach ($n in $a.cmds) { $path = Find-Cmd $n; if ($path) { $cmd = $n; break } }
    [pscustomobject]@{ id = $a.id; nome = $a.nome; instalado = [bool]$path; caminho = $path; comando = $a.abrir; instalar = $a.instalar; versao = $null }
  }
  # Windows PowerShell 5.1 não tem ForEach-Object -Parallel. A lista ainda sai;
  # a versão fica em branco e o menu mostra "instalado".
  if ($PSVersionTable.PSVersion.Major -lt 7) {
    return @($base)
  }
  # Versões em paralelo, com limite de tempo (CLIs em Node demoram ~1s cada).
  $versoes = $base | Where-Object instalado | ForEach-Object -ThrottleLimit 8 -Parallel {
    $p = $_.caminho
    $j = Start-ThreadJob { param($x) & $x --version 2>&1 | Out-String } -ArgumentList $p
    $out = if (Wait-Job $j -Timeout 12) { Receive-Job $j } else { Stop-Job $j; '' }
    Remove-Job $j -Force -ErrorAction SilentlyContinue
    $linha = ($out -split "`r?`n" | Where-Object { $_ -match '\d+\.\d+' } | Select-Object -First 1)
    [pscustomobject]@{ id = $_.id; versao = if ($linha) { ([regex]::Match($linha, 'v?\d+(\.\d+)+([-.][0-9A-Za-z.]+)?')).Value } else { $null } }
  }
  foreach ($v in $versoes) { ($base | Where-Object id -eq $v.id).versao = $v.versao }
  return $base
}

function Open-AgentTerminal([string]$Title, [string]$Command) {
  $pwsh7 = Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'
  $shell = if (Test-Path -LiteralPath $pwsh7) { $pwsh7 } else { Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe' }
  $inner = "Set-Location -LiteralPath '$($Project.Replace("'","''"))'; Write-Host '=== $Title ===' -ForegroundColor Cyan; $Command"
  $wt = Get-Command wt.exe -ErrorAction SilentlyContinue
  if ($wt) {
    Start-Process -FilePath $wt.Source -ArgumentList @(
      '-w', 'new', '-d', $Project, '--', $shell, '-NoLogo', '-NoExit', '-Command', $inner
    )
  } else {
    Start-Process -FilePath $shell -WorkingDirectory $Project -ArgumentList @('-NoLogo', '-NoExit', '-Command', $inner)
  }
  Write-Host "Terminal aberto: $Title" -ForegroundColor Green
}

function Probe-Http([string]$Url) {
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return "HTTP $($r.StatusCode)"
  } catch {
    return "offline ($($_.Exception.Message.Split([char]10)[0]))"
  }
}

switch ($Action) {
  'status-json' {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    ConvertTo-Json -InputObject @(Get-AgentStatus) -Depth 4
  }

  'status' {
    Write-Host "===== Agentes CLI =====" -ForegroundColor Cyan
    foreach ($s in Get-AgentStatus) {
      if ($s.instalado) { Write-Host ("{0,-24} {1,-14} {2}" -f $s.nome, $(if ($s.versao) { $s.versao } else { '?' }), $s.caminho) -ForegroundColor Green }
      else { Write-Host ("{0,-24} não instalado  {1}" -f $s.nome, $s.instalar) -ForegroundColor Yellow }
    }
    foreach ($n in @('llama-server', 'llama-cli')) {
      $p = Find-Cmd $n
      Write-Host ("{0,-24} {1}" -f $n, $(if ($p) { $p } else { 'não encontrado no PATH' }))
    }
    Write-Host ""
    Write-Host ("llama.cpp  :8080  {0}" -f (Probe-Http 'http://127.0.0.1:8080/v1/models'))
    Write-Host ("LM Studio  :1234  {0}" -f (Probe-Http 'http://127.0.0.1:1234/v1/models'))
    Write-Host ("Ollama     :11434 {0}" -f (Probe-Http 'http://127.0.0.1:11434/api/tags'))
    Write-Host ("9Router    :20128 {0}" -f (Probe-Http 'http://127.0.0.1:20128/v1/models'))
    Write-Host ("Mestre     :7777  {0}" -f (Probe-Http 'http://127.0.0.1:7777/ping'))
  }

  'install-opencode' {
    # Só roda quando o usuário escolhe esta operação explicitamente no catálogo.
    $bash = @(
      'C:\Program Files\Git\bin\bash.exe',
      'C:\Program Files\Git\usr\bin\bash.exe'
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $bash) {
      Write-Host "Git Bash nao encontrado. Instale Git for Windows." -ForegroundColor Red
      exit 1
    }
    Write-Host "Instalando OpenCode (opencode.ai/v2/install)..." -ForegroundColor Cyan
    & $bash -lc "curl -fsSL https://opencode.ai/v2/install | bash"
    $bin = Join-Path $env:USERPROFILE '.opencode\bin'
    if (Test-Path $bin) {
      $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
      if ($userPath -notlike "*$bin*") {
        [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $bin), 'User')
        $env:Path = $bin + ';' + $env:Path
        Write-Host "PATH do usuario atualizado: $bin" -ForegroundColor Green
      }
    }
    $exe = Find-Cmd 'opencode'
    if ($exe) {
      Write-Host "OpenCode em $exe" -ForegroundColor Green
      & $exe --version
    } else {
      Write-Host "Instalacao rodou; abra um terminal novo e rode opencode --version." -ForegroundColor Yellow
    }
  }

  'llamacpp-status' {
    Write-Host "===== llama.cpp =====" -ForegroundColor Cyan
    Write-Host ("API  http://127.0.0.1:8080/v1  {0}" -f (Probe-Http 'http://127.0.0.1:8080/v1/models'))
    $srv = Find-Cmd 'llama-server'
    $cli = Find-Cmd 'llama-cli'
    if ($srv) { Write-Host "llama-server: $srv" } else { Write-Host "llama-server nao esta no PATH. Suba o servidor e aponte o provedor llama.cpp no painel de chaves." -ForegroundColor Yellow }
    if ($cli) { Write-Host "llama-cli: $cli" }
    Write-Host "No Mestre: Chaves de API -> llama.cpp -> Testar conexao (porta 8080)."
  }

  default {
    $a = $Agentes | Where-Object { $_.id -eq $Action } | Select-Object -First 1
    $path = $null
    foreach ($n in $a.cmds) { $path = Find-Cmd $n; if ($path) { break } }
    if (-not $path) {
      $link = if ($a.instalar) { " Instale pelo link oficial: $($a.instalar)" } else { '' }
      Write-Host "$($a.nome) não está instalado. O Mestre não instala sozinho.$link" -ForegroundColor Red
      exit 1
    }
    Open-AgentTerminal $a.nome $a.abrir
  }
}
