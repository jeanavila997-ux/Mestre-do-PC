#Requires -Version 7
<#
.SYNOPSIS
  Ações fixas do cliente OneDrive para a whitelist do Mestre do PC.

.EXAMPLE
  pwsh -NoProfile -File .\scripts\onedrive.ps1 -Action status
#>
param(
    [Parameter(Mandatory)]
    [ValidateSet('status', 'abrir', 'config', 'pasta', 'web', 'armazenamento', 'reiniciar')]
    [string]$Action
)

$ErrorActionPreference = 'Stop'

function Get-OneDriveExe {
    $candidatos = @(
        (Join-Path $env:ProgramFiles 'Microsoft OneDrive\OneDrive.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft OneDrive\OneDrive.exe'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\OneDrive\OneDrive.exe')
    )
    foreach ($caminho in $candidatos) {
        if ($caminho -and (Test-Path -LiteralPath $caminho)) {
            return $caminho
        }
    }
    throw 'OneDrive.exe não encontrado em Program Files nem em %LOCALAPPDATA%.'
}

function Get-OneDrivePasta {
    $pasta = Join-Path $env:USERPROFILE 'OneDrive'
    if (Test-Path -LiteralPath $pasta) {
        return $pasta
    }
    throw "Pasta do OneDrive não encontrada em $pasta"
}

function Get-OneDriveProcessos {
    @(Get-Process -Name 'OneDrive' -ErrorAction SilentlyContinue)
}

function Show-OneDriveStatus {
    $exe = Get-OneDriveExe
    $pasta = Get-OneDrivePasta
    $procs = Get-OneDriveProcessos
    Write-Host "Cliente : $exe"
    Write-Host ("Versao  : {0}" -f (Get-Item -LiteralPath $exe).VersionInfo.FileVersion)
    Write-Host "Pasta   : $pasta"
    if ($procs.Count -eq 0) {
        Write-Host 'Estado  : parado'
        return
    }
    Write-Host "Estado  : em execucao ($($procs.Count) processo(s))"
    foreach ($proc in $procs) {
        Write-Host ("          PID {0}" -f $proc.Id)
    }
}

function Start-OneDriveCliente {
    $exe = Get-OneDriveExe
    # Sem /background o processo abre o Explorador e o sincronizador nao sobe.
    Start-Process -FilePath $exe -ArgumentList '/background'
    Write-Host 'OneDrive iniciado em segundo plano.'
}

function Open-OneDriveConfig {
    $exe = Get-OneDriveExe
    # /settings nao esta na lista oficial. Se a janela nao aparecer, use o icone da bandeja.
    Start-Process -FilePath $exe -ArgumentList '/settings'
    Write-Host 'Pedido de configuracoes enviado ao cliente.'
}

function Open-OneDrivePasta {
    $pasta = Get-OneDrivePasta
    Start-Process -FilePath explorer.exe -ArgumentList $pasta
    Write-Host "Pasta aberta: $pasta"
}

function Open-OneDriveWeb {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url
    )
    Start-Process $Url
    Write-Host "Aberto: $Url"
}

function Restart-OneDriveCliente {
    $exe = Get-OneDriveExe
    $vivos = Get-OneDriveProcessos
    if ($vivos.Count -eq 0) {
        Write-Host 'O cliente ja estava parado.'
    }
    else {
        Write-Host 'Encerrando o cliente com /shutdown...'
        $encerrar = Start-Process -FilePath $exe -ArgumentList '/shutdown' -PassThru
        if ($encerrar) {
            $null = $encerrar.WaitForExit(15000)
        }
        $limite = (Get-Date).AddSeconds(20)
        do {
            Start-Sleep -Milliseconds 400
            $vivos = Get-OneDriveProcessos
        } while ($vivos.Count -gt 0 -and (Get-Date) -lt $limite)

        if ($vivos.Count -gt 0) {
            Write-Host 'Ainda em execucao. Forcando o encerramento de OneDrive.exe...'
            $vivos | Stop-Process -Force
            Start-Sleep -Seconds 1
        }
    }
    Start-OneDriveCliente
}

switch ($Action) {
    'status' { Show-OneDriveStatus }
    'abrir' { Start-OneDriveCliente }
    'config' { Open-OneDriveConfig }
    'pasta' { Open-OneDrivePasta }
    'web' { Open-OneDriveWeb -Url 'https://onedrive.live.com' }
    'armazenamento' { Open-OneDriveWeb -Url 'https://onedrive.live.com/?v=managestorage' }
    'reiniciar' { Restart-OneDriveCliente }
}
