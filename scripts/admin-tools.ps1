<#
.SYNOPSIS
  Administração do PC pelo Mestre do PC (extensão, painel e MCP).

.DESCRIPTION
  Allowlist fixa: só as ações do ValidateSet. Nada de comando livre.
  O que precisa de administrador abre uma janela nova com UAC visível
  (Start-Process -Verb RunAs) e só roda lá dentro, com -Elevado.
  Fora do escopo de propósito: esvaziar a Lixeira, apagar arquivos pessoais,
  desligar Defender/UAC/firewall. Reiniciar/desligar o PC são agendados em 60 s.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\admin-tools.ps1 -Action defender-status
#>
param(
  [Parameter(Mandatory)]
  [ValidateSet(
    'reiniciar-mestre',
    'criar-ponto-restauracao',
    'turbo-admin',
    'sfc-verificar',
    'sfc-reparar',
    'dism-verificar',
    'dism-reparar',
    'winget-listar',
    'winget-atualizar-tudo',
    'reiniciar-ollama',
    'reiniciar-spooler',
    'flush-dns',
    'renovar-rede',
    'abrir-gerenciador-tarefas',
    'abrir-servicos',
    'abrir-eventos',
    'abrir-disco',
    'apps-inicializacao',
    'defender-status',
    'defender-verificacao-rapida',
    'reiniciar-pc',
    'desligar-pc',
    'cancelar-desligamento'
  )]
  [string] $Action,

  # Uso interno: indica que já estamos na janela elevada aberta por este script.
  [switch] $Elevado
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

# Ações que exigem administrador -> abrem janela com UAC.
$Elevadas = @{
  'reiniciar-mestre'            = 'encerrar o launcher na porta 7777 e subir de novo pela tarefa'
  'criar-ponto-restauracao'     = 'criar um ponto de restauração'
  'turbo-admin'                 = 'limpar Temp do Windows (>24 h), componentes e cache do Windows Update e fazer retrim'
  'sfc-verificar'               = 'sfc /verifyonly'
  'sfc-reparar'                 = 'sfc /scannow'
  'dism-verificar'              = 'DISM /CheckHealth e /ScanHealth'
  'dism-reparar'                = 'DISM /RestoreHealth'
  'winget-atualizar-tudo'       = 'winget upgrade --all'
  'reiniciar-spooler'           = 'reiniciar o serviço Spooler'
  'renovar-rede'                = 'limpar DNS e renovar o IP'
  'defender-verificacao-rapida' = 'verificação rápida do Defender'
}

function Test-Admin {
  ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-Titulo([string] $Texto) {
  Write-Host ''
  Write-Host "===== $Texto =====" -ForegroundColor Cyan
}

if ($Elevadas.ContainsKey($Action) -and -not $Elevado) {
  $argumentos = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath), '-Action', $Action, '-Elevado')
  try {
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argumentos -ErrorAction Stop | Out-Null
    Write-Host "Janela de administrador aberta (UAC) para $($Elevadas[$Action]). O resultado aparece naquela janela." -ForegroundColor Cyan
    # 10 = "aberto como admin": o painel não marca sucesso nem falha, porque o
    # trabalho ainda vai rodar na outra janela.
    exit 10
  } catch {
    Write-Host "UAC recusado ou falhou: $($_.Exception.Message)" -ForegroundColor Yellow
    exit 1
  }
}

if ($Elevadas.ContainsKey($Action) -and -not (Test-Admin)) {
  Write-Host 'Esta ação precisa de administrador. Rode pelo Mestre (abre o UAC).' -ForegroundColor Red
  exit 1
}

if ($Elevado) {
  try { $Host.UI.RawUI.WindowTitle = "Mestre do PC (admin): $Action" } catch { }
}

$codigo = 0
switch ($Action) {
  'reiniciar-mestre' {
    Write-Titulo 'Reiniciar o Mestre do PC (porta 7777)'
    $conexoes = Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conexoes) {
      $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
      if ($proc -and $proc.ProcessName -in @('node', 'pwsh', 'powershell')) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        Write-Host "Encerrado $($proc.ProcessName) (PID $($proc.Id))."
      } elseif ($proc) {
        Write-Host "A porta 7777 está com '$($proc.ProcessName)' (PID $($proc.Id)); não encerrei por não ser o Mestre." -ForegroundColor Yellow
      }
    }
    Start-Sleep -Seconds 2
    if (Get-ScheduledTask -TaskName 'MestreDoPC_Admin_Launcher' -ErrorAction SilentlyContinue) {
      Start-ScheduledTask -TaskName 'MestreDoPC_Admin_Launcher'
      Write-Host 'Tarefa MestreDoPC_Admin_Launcher iniciada.'
    } else {
      Write-Host 'Tarefa MestreDoPC_Admin_Launcher não encontrada. Inicie o Mestre pelo start-v10.bat.' -ForegroundColor Yellow
    }
    $ok = $false
    for ($i = 0; $i -lt 25; $i++) {
      Start-Sleep -Seconds 1
      try {
        $r = Invoke-RestMethod -Uri 'http://127.0.0.1:7777/ping' -TimeoutSec 2
        Write-Host "Mestre online (versão $($r.version), PID $($r.pid))." -ForegroundColor Green
        $ok = $true
        break
      } catch { }
    }
    if (-not $ok) { Write-Host 'O Mestre não respondeu em 25 s.' -ForegroundColor Red; $codigo = 1 }
  }

  'criar-ponto-restauracao' {
    Write-Titulo 'Ponto de restauração'
    try {
      Enable-ComputerRestore -Drive "$env:SystemDrive\" -ErrorAction SilentlyContinue
      Checkpoint-Computer -Description 'Mestre do PC (manual)' -RestorePointType MODIFY_SETTINGS -ErrorAction Stop
      Write-Host 'Ponto de restauração criado.' -ForegroundColor Green
    } catch {
      Write-Host "Não criou: $($_.Exception.Message)" -ForegroundColor Yellow
      Write-Host 'O Windows só aceita um ponto a cada 24 h por padrão.'
      $codigo = 1
    }
    Get-ComputerRestorePoint -ErrorAction SilentlyContinue | Select-Object -Last 3 CreationTime, Description | Format-Table -AutoSize
  }

  'turbo-admin' {
    Write-Titulo 'Turbo admin (não mexe na Lixeira nem em arquivos pessoais)'
    $livreAntes = (Get-PSDrive C).Free
    Write-Host '1/5 Ponto de restauração...'
    try { Enable-ComputerRestore -Drive "$env:SystemDrive\" -ErrorAction SilentlyContinue; Checkpoint-Computer -Description 'Mestre Turbo admin' -RestorePointType MODIFY_SETTINGS -ErrorAction Stop } catch { Write-Host "  $($_.Exception.Message)" -ForegroundColor Yellow }
    Write-Host '2/5 C:\Windows\Temp (arquivos com mais de 24 h)...'
    $limite = (Get-Date).AddHours(-24)
    Get-ChildItem -LiteralPath "$env:SystemRoot\Temp" -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $limite } | Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Host '3/5 Componentes do Windows Update (DISM StartComponentCleanup)...'
    Dism.exe /Online /Cleanup-Image /StartComponentCleanup /Quiet /NoRestart
    Write-Host '4/5 Cache de download do Windows Update...'
    Stop-Service -Name wuauserv, bits -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath "$env:SystemRoot\SoftwareDistribution\Download" -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Start-Service -Name bits, wuauserv -ErrorAction SilentlyContinue
    Write-Host '5/5 Retrim do C:...'
    Optimize-Volume -DriveLetter C -ReTrim -ErrorAction SilentlyContinue
    Write-Host ("Liberado no C: {0:N2} GB" -f (((Get-PSDrive C).Free - $livreAntes) / 1GB)) -ForegroundColor Green
  }

  'sfc-verificar' { Write-Titulo 'SFC: só verificar'; sfc.exe /verifyonly; $codigo = $LASTEXITCODE }
  'sfc-reparar' { Write-Titulo 'SFC: verificar e reparar'; sfc.exe /scannow; $codigo = $LASTEXITCODE }
  'dism-verificar' {
    Write-Titulo 'DISM: verificar a imagem'
    Dism.exe /Online /Cleanup-Image /CheckHealth
    Dism.exe /Online /Cleanup-Image /ScanHealth
    $codigo = $LASTEXITCODE
  }
  'dism-reparar' { Write-Titulo 'DISM: RestoreHealth'; Dism.exe /Online /Cleanup-Image /RestoreHealth; $codigo = $LASTEXITCODE }

  'winget-listar' {
    Write-Titulo 'Atualizações disponíveis (winget)'
    winget upgrade --accept-source-agreements --disable-interactivity
  }
  'winget-atualizar-tudo' {
    Write-Titulo 'Atualizar todos os apps (winget)'
    winget upgrade --all --accept-source-agreements --accept-package-agreements --disable-interactivity
    $codigo = $LASTEXITCODE
  }

  'reiniciar-ollama' {
    Write-Titulo 'Reiniciar o Ollama'
    Get-Process -Name 'ollama app', 'ollama' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $exe = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama app.exe'
    if (Test-Path -LiteralPath $exe) {
      # Pelo Explorer, para o Ollama subir como usuário normal (não elevado).
      Start-Process -FilePath 'explorer.exe' -ArgumentList ('"{0}"' -f $exe)
      $ok = $false
      for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 1
        try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 2 | Out-Null; $ok = $true; break } catch { }
      }
      if ($ok) { Write-Host 'Ollama de volta em 127.0.0.1:11434.' -ForegroundColor Green } else { Write-Host 'Ollama aberto, mas ainda não respondeu.' -ForegroundColor Yellow }
    } else {
      Write-Host "Ollama não encontrado em $exe." -ForegroundColor Red
      $codigo = 1
    }
  }
  'reiniciar-spooler' {
    Write-Titulo 'Reiniciar o spooler de impressão'
    Restart-Service -Name Spooler -Force
    Get-Service -Name Spooler | Select-Object Name, Status | Format-Table -AutoSize
  }
  'flush-dns' { Write-Titulo 'Limpar cache DNS'; ipconfig /flushdns }
  'renovar-rede' {
    Write-Titulo 'Limpar DNS e renovar IP'
    ipconfig /flushdns
    ipconfig /release | Out-Null
    Start-Sleep -Seconds 2
    ipconfig /renew | Out-Null
    Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway } | Select-Object InterfaceAlias, @{ n = 'IPv4'; e = { $_.IPv4Address.IPAddress } } | Format-Table -AutoSize
  }

  'abrir-gerenciador-tarefas' { Start-Process -FilePath 'taskmgr.exe'; Write-Host 'Gerenciador de Tarefas aberto.' }
  'abrir-servicos' { Start-Process -FilePath 'services.msc'; Write-Host 'Serviços aberto.' }
  'abrir-eventos' { Start-Process -FilePath 'eventvwr.msc'; Write-Host 'Visualizador de Eventos aberto.' }
  'abrir-disco' { Start-Process -FilePath 'diskmgmt.msc'; Write-Host 'Gerenciamento de Disco aberto.' }

  'apps-inicializacao' {
    Write-Titulo 'Apps de inicialização (só leitura)'
    $desativados = @{}
    foreach ($chave in @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run',
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder')) {
      $props = Get-ItemProperty -Path $chave -ErrorAction SilentlyContinue
      if (-not $props) { continue }
      foreach ($p in $props.PSObject.Properties) {
        if ($p.Name -like 'PS*') { continue }
        if ($p.Value -is [byte[]] -and $p.Value.Length -gt 0 -and $p.Value[0] -ne 2 -and $p.Value[0] -ne 6) { $desativados[$p.Name] = $true }
      }
    }
    Get-CimInstance Win32_StartupCommand -ErrorAction SilentlyContinue |
      Select-Object Name, @{ n = 'Estado'; e = { if ($desativados.ContainsKey($_.Name)) { 'desativado' } else { 'ativo' } } }, Location,
        @{ n = 'Comando'; e = { $c = [string]$_.Command; if ($c.Length -gt 90) { $c.Substring(0, 90) + '…' } else { $c } } } |
      Sort-Object Estado, Name | Format-Table -AutoSize -Wrap
  }
  'defender-status' {
    Write-Titulo 'Microsoft Defender'
    Get-MpComputerStatus | Select-Object AMRunningMode, AntivirusEnabled, RealTimeProtectionEnabled, AntivirusSignatureLastUpdated, AntivirusSignatureVersion, QuickScanEndTime, FullScanEndTime | Format-List
  }
  'defender-verificacao-rapida' {
    Write-Titulo 'Defender: verificação rápida'
    Start-MpScan -ScanType QuickScan
    Get-MpComputerStatus | Select-Object QuickScanEndTime, AntivirusSignatureLastUpdated | Format-List
    Get-MpThreatDetection -ErrorAction SilentlyContinue | Select-Object -Last 5 InitialDetectionTime, ThreatID, ActionSuccess | Format-Table -AutoSize
  }

  'reiniciar-pc' {
    shutdown.exe /r /t 60 /c 'Mestre do PC: reinicio em 60 s. Para cancelar: shutdown /a'
    Write-Host 'Reinício agendado para daqui a 60 s. Cancele com "Cancelar reinício/desligamento".' -ForegroundColor Yellow
  }
  'desligar-pc' {
    shutdown.exe /s /t 60 /c 'Mestre do PC: desligamento em 60 s. Para cancelar: shutdown /a'
    Write-Host 'Desligamento agendado para daqui a 60 s. Cancele com "Cancelar reinício/desligamento".' -ForegroundColor Yellow
  }
  'cancelar-desligamento' {
    shutdown.exe /a 2>$null
    if ($LASTEXITCODE -eq 0) { Write-Host 'Reinício/desligamento cancelado.' -ForegroundColor Green } else { Write-Host 'Não havia reinício/desligamento agendado.' }
  }
}

if ($Elevado) {
  Write-Host ''
  Read-Host 'Pronto. Aperte Enter para fechar esta janela' | Out-Null
}
exit $codigo
