[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ProjectRoot,
    [string]$NodePath,
    [string]$ConfigRoot = $env:USERPROFILE,
    [string[]]$Client = @("All")
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path

if (-not $NodePath) {
    $NodePath = (Get-Command node -ErrorAction Stop).Source
}
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path
$ConfigRoot = [System.IO.Path]::GetFullPath($ConfigRoot)

$mcpEntry = Join-Path $ProjectRoot "mcp-server\index.js"
$launcherEntry = Join-Path $ProjectRoot "v10\launcher.js"
$packageFile = Join-Path $ProjectRoot "package.json"

if (-not (Test-Path -LiteralPath $mcpEntry -PathType Leaf)) {
    throw "mcp-server/index.js nao encontrado em $ProjectRoot"
}
if (-not (Test-Path -LiteralPath $launcherEntry -PathType Leaf)) {
    throw "v10/launcher.js nao encontrado em $ProjectRoot"
}
if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) {
    throw "package.json nao encontrado em $ProjectRoot"
}

$versionText = (& $NodePath --version 2>$null | Select-Object -First 1)
if ([string]::IsNullOrWhiteSpace($versionText)) {
    throw "Nao foi possivel obter a versao do Node em $NodePath"
}
$version = $versionText.Trim().TrimStart("v")
$versionParts = $version.Split(".")
$major = [int]$versionParts[0]
$minor = if ($versionParts.Length -gt 1) { [int]$versionParts[1] } else { 0 }
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 13)) {
    throw "Node $version encontrado; e necessario Node >= 22.13.0"
}

$knownClients = @("OpenCode", "ClaudeCode", "ClaudeDesktop", "Cline", "Codex", "Grok")
$selected = @()
foreach ($name in $Client) {
    if ($name -eq "All") {
        $selected = $knownClients
        break
    }
    if ($name -notin $knownClients) {
        throw "Cliente desconhecido: $name"
    }
    if ($name -notin $selected) {
        $selected += $name
    }
}

$baseUrl = "http://127.0.0.1:7777"
$stdioServer = [pscustomobject]@{
    type    = "stdio"
    command = $NodePath
    args    = @($mcpEntry)
    env     = [pscustomobject]@{
        MESTRE_PROJETO_PATH = $ProjectRoot
        MESTRE_BASE_URL     = $baseUrl
    }
}

function Get-ClientPath {
    param([string]$Name)

    switch ($Name) {
        "OpenCode" { return (Join-Path $ConfigRoot ".config\opencode\opencode.json") }
        "ClaudeCode" { return (Join-Path $ConfigRoot ".claude.json") }
        "ClaudeDesktop" { return (Join-Path $ConfigRoot "AppData\Roaming\Claude\claude_desktop_config.json") }
        "Cline" { return (Join-Path $ConfigRoot ".cline\data\settings\cline_mcp_settings.json") }
        "Codex" { return (Join-Path $ConfigRoot ".codex\config.toml") }
        "Grok" { return (Join-Path $ConfigRoot ".grok\config.toml") }
    }
    throw "Cliente sem caminho: $Name"
}

function Backup-ConfigFile {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }
    $stamp = Get-Date -Format "yyyyMMdd-HHmmssfff"
    $backup = "$Path.bak-mcp-installer-$stamp"
    Copy-Item -LiteralPath $Path -Destination $backup
    return $backup
}

function Read-JsonConfig {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{}
    }
    $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path
    if ([string]::IsNullOrWhiteSpace($text)) {
        return [pscustomobject]@{}
    }
    return $text | ConvertFrom-Json
}

function Write-JsonConfig {
    param([string]$Path, [object]$Data)

    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $json = $Data | ConvertTo-Json -Depth 100
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, "$json`n", $utf8)
}

function Set-OpenCodeServer {
    param([object]$Data)

    if ($null -eq $Data.PSObject.Properties["mcp"]) {
        $Data | Add-Member -NotePropertyName "mcp" -NotePropertyValue ([pscustomobject]@{})
    }
    if ($null -eq $Data.mcp.PSObject.Properties["servers"]) {
        $Data.mcp | Add-Member -NotePropertyName "servers" -NotePropertyValue ([pscustomobject]@{})
    }
    $server = [pscustomobject]@{
        type        = "local"
        command     = @($NodePath, $mcpEntry)
        cwd         = $ProjectRoot
        environment = [pscustomobject]@{
            MESTRE_PROJETO_PATH = $ProjectRoot
            MESTRE_BASE_URL     = $baseUrl
        }
    }
    $Data.mcp.servers | Add-Member -NotePropertyName "mestre-do-pc" -NotePropertyValue $server -Force
}

function Set-ClaudeServer {
    param([object]$Data)

    if ($null -eq $Data.PSObject.Properties["mcpServers"]) {
        $Data | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue ([pscustomobject]@{})
    }
    $Data.mcpServers | Add-Member -NotePropertyName "mestre-do-pc" -NotePropertyValue $stdioServer -Force
}

function Set-ClineServer {
    param([object]$Data)

    if ($null -eq $Data.PSObject.Properties["mcpServers"]) {
        $Data | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue ([pscustomobject]@{})
    }
    $server = [pscustomobject]@{
        transport = [pscustomobject]@{
            type    = "stdio"
            command = $NodePath
            args    = @($mcpEntry)
            env     = [pscustomobject]@{
                MESTRE_PROJETO_PATH = $ProjectRoot
                MESTRE_BASE_URL     = $baseUrl
            }
        }
    }
    $Data.mcpServers | Add-Member -NotePropertyName "mestre-do-pc" -NotePropertyValue $server -Force
}

function ConvertTo-TomlString {
    param([string]$Value)

    return '"' + $Value.Replace("\", "\\").Replace('"', '\"') + '"'
}

function New-TomlBlock {
    param([string]$Name, [bool]$Grok)

    $node = ConvertTo-TomlString $NodePath
    $entry = ConvertTo-TomlString $mcpEntry
    $project = ConvertTo-TomlString $ProjectRoot
    $url = ConvertTo-TomlString $baseUrl
    $lines = @(
        "[mcp_servers.$Name]",
        "command = $node",
        "args = [$entry]"
    )
    if ($Grok) {
        $lines += "enabled = true"
        $lines += "startup_timeout_sec = 90"
    }
    $lines += @(
        "",
        "[mcp_servers.$Name.env]",
        "MESTRE_BASE_URL = $url",
        "MESTRE_PROJETO_PATH = $project"
    )
    return $lines
}

function Update-TomlConfig {
    param([string]$Path, [string]$Name, [bool]$Grok)

    $original = ""
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $original = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path
    }
    $newline = if ($original.Contains("`r`n")) { "`r`n" } else { "`n" }
    $lines = [System.Collections.Generic.List[string]]::new()
    if ($original.Length -gt 0) {
        $lines.AddRange([string[]]($original -split "\r?\n"))
    }

    $mainHeader = "[mcp_servers.$Name]"
    $subPrefix = "[mcp_servers.$Name."
    $start = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $trimmed = $lines[$i].Trim()
        if ($trimmed -eq $mainHeader -or $trimmed.StartsWith($subPrefix)) {
            $start = $i
            break
        }
    }

    $block = New-TomlBlock -Name $Name -Grok $Grok
    if ($start -lt 0) {
        while ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq "") {
            $lines.RemoveAt($lines.Count - 1)
        }
        if ($lines.Count -gt 0) {
            $lines.Add("")
        }
        $lines.AddRange([string[]]$block)
    } else {
        $end = $lines.Count
        for ($i = $start + 1; $i -lt $lines.Count; $i++) {
            $trimmed = $lines[$i].Trim()
            if (-not $trimmed.StartsWith("[")) {
                continue
            }
            if ($trimmed -eq $mainHeader -or $trimmed.StartsWith($subPrefix)) {
                continue
            }
            $end = $i
            break
        }
        $lines.RemoveRange($start, $end - $start)
        $lines.InsertRange($start, [string[]]$block)
    }

    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, ($lines -join $newline), $utf8)
}

$results = @()
foreach ($name in $selected) {
    $file = Get-ClientPath -Name $name
    if (-not $PSCmdlet.ShouldProcess($file, "Atualizar MCP mestre-do-pc para $name")) {
        $results += [pscustomobject]@{ Client = $name; Path = $file; Changed = $false; Backup = $null }
        continue
    }

    $backup = Backup-ConfigFile -Path $file
    switch ($name) {
        "OpenCode" {
            $data = Read-JsonConfig -Path $file
            Set-OpenCodeServer -Data $data
            Write-JsonConfig -Path $file -Data $data
        }
        "ClaudeCode" {
            $data = Read-JsonConfig -Path $file
            Set-ClaudeServer -Data $data
            Write-JsonConfig -Path $file -Data $data
        }
        "ClaudeDesktop" {
            $data = Read-JsonConfig -Path $file
            Set-ClaudeServer -Data $data
            Write-JsonConfig -Path $file -Data $data
        }
        "Cline" {
            $data = Read-JsonConfig -Path $file
            Set-ClineServer -Data $data
            Write-JsonConfig -Path $file -Data $data
        }
        "Codex" {
            Update-TomlConfig -Path $file -Name "mestre_do_pc" -Grok $false
        }
        "Grok" {
            Update-TomlConfig -Path $file -Name "mestre-do-pc" -Grok $true
        }
    }
    $results += [pscustomobject]@{ Client = $name; Path = $file; Changed = $true; Backup = $backup }
}

$results | Format-Table -AutoSize
