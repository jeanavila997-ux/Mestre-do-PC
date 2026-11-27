param(
    [string] $InstallDir = $PSScriptRoot,
    [string] $TaskName  = "MestreDoPC_Admin_Launcher",
    [switch] $Quiet
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "Resolve-MestreNode.ps1")
$nodeExe = Resolve-MestreNode
if (-not $nodeExe) {
    Write-Error "Node.js não encontrado no PATH nem em %LOCALAPPDATA%\Programs\nodejs. Instale o Node.js LTS antes de registrar o launcher."
    exit 1
}

$launcherPath = Join-Path $InstallDir "v10\launcher.js"
if (-not (Test-Path $launcherPath)) {
    Write-Error "Launcher Node.js não encontrado em: $launcherPath"
    exit 1
}

$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name

try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
} catch { }

$action = New-ScheduledTaskAction `
    -Execute $nodeExe `
    -Argument "`"$launcherPath`"" `
    -WorkingDirectory (Join-Path $InstallDir "v10")

$trigger = New-ScheduledTaskTrigger -AtLogon -User $userId

# RunLevel Highest permite que o launcher Node.js execute subprocessos PowerShell com privilégios elevados.
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action   $action  `
    -Trigger  $trigger `
    -Principal $principal `
    -Settings  $settings `
    -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
if (-not $task) {
    Write-Error "Falha ao validar a tarefa '$TaskName'."
    exit 1
}

if (-not $Quiet) {
    Write-Host "[OK] Tarefa '$TaskName' registrada com trigger AtLogon para $launcherPath" -ForegroundColor Green
}
