<#
.SYNOPSIS
  Turbo PC — revisão e melhoria do Windows pelo Mestre do PC.
.DESCRIPTION
  -Modo diagnostico : somente leitura. Devolve JSON com rótulos em pt-BR.
  -Modo otimizar    : exige -Confirmar. Cria backup + desfazer.ps1 + rodar-como-admin.ps1
                      + relatório na pasta de backup. Nunca esvazia a Lixeira, nunca apaga
                      Downloads/Documentos/Desktop nem modelos do Ollama, não mexe no cache npm.
#>
[CmdletBinding()]
param(
  [ValidateSet('diagnostico','otimizar')][string]$Modo = 'diagnostico',
  [switch]$Confirmar,
  [string]$PastaBackup,
  [switch]$SemTamanhos
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# Nunca desativar nada que case com este padrão.
$Protegidos = 'ollama|9router|mestre|onedrive|tailscale|vpn|security|defender|rtk|realtek|nvidia|intel|grok|nitrosense|acer|igfx|audio|driver'
# Itens de inicialização claramente dispensáveis (desativados via StartupApproved, reversível).
$Dispensaveis = 'Enviar para o OneNote|Send to OneNote|CanvaAutoLaunch|MicrosoftEdgeAutoLaunch|GoogleChromeAutoLaunch|Spotify|Discord|Steam|EpicGamesLauncher|Teams'

function Write-Utf8Bom([string]$Caminho, [string]$Texto) {
  # .ps1 gerado com BOM: o Windows PowerShell 5.1 lê sem BOM como ANSI e quebra acentos.
  [IO.File]::WriteAllText($Caminho, $Texto, (New-Object System.Text.UTF8Encoding $true))
}

function Test-Admin {
  ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-TamanhoGB([string]$Caminho) {
  if (-not $Caminho) { return $null }
  try {
    if (-not (Test-Path -LiteralPath $Caminho -ErrorAction Stop)) { return $null }
    $s = (Get-ChildItem -LiteralPath $Caminho -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    return [math]::Round(([double]$s) / 1GB, 2)
  } catch { return 'sem_acesso' }
}

function Get-Pastas {
  $L = $env:LOCALAPPDATA; $U = $env:USERPROFILE
  $ollama = if ($env:OLLAMA_MODELS) { $env:OLLAMA_MODELS } else { Join-Path $U '.ollama\models' }
  @(
    @{ nome = 'TEMP do usuário'; caminho = $env:TEMP; limpavel = 'sim (>24h)' }
    @{ nome = 'Windows\Temp'; caminho = 'C:\Windows\Temp'; limpavel = 'admin' }
    @{ nome = 'Prefetch'; caminho = 'C:\Windows\Prefetch'; limpavel = 'não (o Windows usa)' }
    @{ nome = 'Windows Update (Download)'; caminho = 'C:\Windows\SoftwareDistribution\Download'; limpavel = 'admin' }
    @{ nome = 'Cache npm'; caminho = (Join-Path $L 'npm-cache'); limpavel = 'não automático' }
    @{ nome = 'Store pnpm'; caminho = (Join-Path $L 'pnpm\store'); limpavel = 'sim (prune)' }
    @{ nome = 'Cache bun'; caminho = (Join-Path $U '.bun\install\cache'); limpavel = 'manual' }
    @{ nome = 'Cache pip'; caminho = (Join-Path $L 'pip\Cache'); limpavel = 'sim (purge)' }
    @{ nome = 'Cache uv'; caminho = (Join-Path $L 'uv\cache'); limpavel = 'sim (prune)' }
    @{ nome = 'Pacotes NuGet'; caminho = (Join-Path $U '.nuget\packages'); limpavel = 'manual' }
    @{ nome = 'Modelos Ollama'; caminho = $ollama; limpavel = 'nunca automático' }
    @{ nome = 'Crash dumps do usuário'; caminho = (Join-Path $L 'CrashDumps'); limpavel = 'sim (>7 dias)' }
    @{ nome = 'Minidump'; caminho = 'C:\Windows\Minidump'; limpavel = 'admin' }
    @{ nome = 'Relatórios de erro (WER)'; caminho = 'C:\ProgramData\Microsoft\Windows\WER'; limpavel = 'admin' }
    @{ nome = 'Logs do Windows'; caminho = 'C:\Windows\Logs'; limpavel = 'admin' }
    @{ nome = 'Miniaturas (thumbcache)'; caminho = (Join-Path $L 'Microsoft\Windows\Explorer'); limpavel = 'sim' }
    @{ nome = 'Lixeira C:'; caminho = 'C:\$Recycle.Bin'; limpavel = 'nunca automático' }
  )
}

function Get-Startup {
  $itens = @()
  $aprov = @{}
  foreach ($k in 'Run','StartupFolder') {
    $p = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\$k"
    $props = Get-ItemProperty $p -ErrorAction SilentlyContinue
    if ($props) { $props.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { $aprov["$k|$($_.Name)"] = ([int]$_.Value[0] % 2 -eq 0) } }
  }
  $run = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue
  if ($run) { $run.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object {
      $on = if ($aprov.ContainsKey("Run|$($_.Name)")) { $aprov["Run|$($_.Name)"] } else { $true }
      $itens += [ordered]@{ nome = $_.Name; origem = 'HKCU Run'; ativo = $on; comando = [string]$_.Value } } }
  foreach ($hk in 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run') {
    $r = Get-ItemProperty $hk -ErrorAction SilentlyContinue
    if ($r) { $r.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { $itens += [ordered]@{ nome = $_.Name; origem = 'HKLM Run'; ativo = $true; comando = [string]$_.Value } } }
  }
  foreach ($pasta in "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup", "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup") {
    Get-ChildItem $pasta -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'desktop.ini' } | ForEach-Object {
      $on = if ($aprov.ContainsKey("StartupFolder|$($_.Name)")) { $aprov["StartupFolder|$($_.Name)"] } else { $true }
      $itens += [ordered]@{ nome = $_.Name; origem = 'Pasta Inicializar'; ativo = $on; comando = $_.FullName } }
  }
  # Entradas desativadas que só existem no StartupApproved (ex.: Edge/Canva).
  foreach ($k in $aprov.Keys) {
    $n = $k.Split('|')[1]
    if (-not ($itens | Where-Object { $_.nome -eq $n })) { $itens += [ordered]@{ nome = $n; origem = 'StartupApproved'; ativo = $aprov[$k]; comando = '' } }
  }
  $tarefas = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
      $_.State -ne 'Disabled' -and $_.TaskPath -notlike '\Microsoft\*' -and ($_.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }) } |
    ForEach-Object { [ordered]@{ nome = $_.TaskName; pasta = $_.TaskPath; estado = [string]$_.State } })
  [ordered]@{ itens = $itens; tarefas_no_logon = $tarefas }
}

function Get-Diagnostico([switch]$Leve) {
  $os = Get-CimInstance Win32_OperatingSystem
  $cs = Get-CimInstance Win32_ComputerSystem
  $ramTotal = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
  $ramLivre = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
  $disco = Get-PSDrive C
  $base = [ordered]@{
    data_hora = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    admin = (Test-Admin)
    memoria = [ordered]@{
      ram_total_gb = $ramTotal
      ram_livre_gb = $ramLivre
      ram_uso_pct = [math]::Round((1 - $ramLivre / $ramTotal) * 100, 1)
      memoria_comprometida_gb = [math]::Round(($os.TotalVirtualMemorySize - $os.FreeVirtualMemory) / 1MB, 2)
      limite_comprometida_gb = [math]::Round($os.TotalVirtualMemorySize / 1MB, 2)
    }
    disco_c = [ordered]@{
      livre_gb = [math]::Round($disco.Free / 1GB, 2)
      total_gb = [math]::Round(($disco.Used + $disco.Free) / 1GB, 2)
    }
  }
  if ($Leve) { return $base }

  $base.memoria.compressao_memoria_ativa = [bool](Get-Process -Name 'Memory Compression' -ErrorAction SilentlyContinue)
  $base.memoria.top_processos = @(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 15 |
      ForEach-Object { [ordered]@{ nome = $_.Name; pid = $_.Id; ram_mb = [int]($_.WorkingSet64 / 1MB) } })
  $base.memoria.top_apps_agrupados = @(Get-Process | Group-Object Name | ForEach-Object {
      [ordered]@{ nome = $_.Name; processos = $_.Count; ram_mb = [int](($_.Group | Measure-Object WorkingSet64 -Sum).Sum / 1MB) } } |
      Sort-Object { $_.ram_mb } -Descending | Select-Object -First 10)

  $pf = Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue
  $base.memoria_virtual = [ordered]@{
    automatica = [bool]$cs.AutomaticManagedPagefile
    arquivos = @($pf | ForEach-Object { [ordered]@{ local = $_.Name; tamanho_mb = $_.AllocatedBaseSize; uso_atual_mb = $_.CurrentUsage; pico_mb = $_.PeakUsage } })
    desativada = (-not $pf)
  }

  $trim = (fsutil behavior query DisableDeleteNotify 2>$null) -join ' '
  $base.disco_c.trim_ativo = ($trim -match 'NTFS DisableDeleteNotify = 0')
  $base.discos = @(Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object {
      [ordered]@{ nome = $_.FriendlyName; tipo = [string]$_.MediaType; saude = [string]$_.HealthStatus; tamanho_gb = [int]($_.Size / 1GB) } })

  if (-not $SemTamanhos) {
    $base.pastas = @(Get-Pastas | ForEach-Object { [ordered]@{ nome = $_.nome; caminho = $_.caminho; tamanho_gb = (Get-TamanhoGB $_.caminho); limpeza = $_.limpavel } })
  }

  $base.inicializacao = Get-Startup
  $base.servicos = @(Get-Service WSearch, SysMain, DiagTrack -ErrorAction SilentlyContinue | ForEach-Object {
      [ordered]@{ nome = $_.Name; estado = [string]$_.Status; inicio = [string]$_.StartType } })

  $ativo = (powercfg /getactivescheme) -join ' '
  $bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
  $base.energia = [ordered]@{
    plano_ativo = ($ativo -replace '.*\(([^)]+)\).*', '$1')
    plano_guid = ([regex]::Match($ativo, '[0-9a-f]{8}-[0-9a-f-]{27}').Value)
    na_tomada = if ($bat) { $bat.BatteryStatus -ne 1 } else { $true }
    bateria_pct = if ($bat) { $bat.EstimatedChargeRemaining } else { $null }
    nitrosense_instalado = [bool](Get-ScheduledTask -TaskName 'NitroSense' -ErrorAction SilentlyContinue)
  }

  $prefs = Get-ItemProperty 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences' -ErrorAction SilentlyContinue
  $hags = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' -ErrorAction SilentlyContinue).HwSchMode
  $base.gpu = [ordered]@{
    placas = @(Get-CimInstance Win32_VideoController | ForEach-Object { [ordered]@{ nome = $_.Name; driver = $_.DriverVersion; data_driver = if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { $null } } })
    preferencias_por_app = @(if ($prefs) { $prefs.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { [ordered]@{ app = $_.Name; valor = [string]$_.Value } } })
    agendamento_gpu_hardware = switch ($hags) { 2 { 'ligado' } 1 { 'desligado' } default { 'padrão do Windows (não definido)' } }
  }

  $gb = Get-ItemProperty 'HKCU:\Software\Microsoft\GameBar' -ErrorAction SilentlyContinue
  $vfx = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects' -ErrorAction SilentlyContinue).VisualFXSetting
  $bg = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications' -ErrorAction SilentlyContinue).GlobalUserDisabled
  $base.windows = [ordered]@{
    modo_jogo = if ($null -eq $gb.AutoGameModeEnabled -or $gb.AutoGameModeEnabled -eq 1) { 'ligado' } else { 'desligado' }
    efeitos_visuais = switch ($vfx) { 0 { 'o Windows escolhe' } 1 { 'melhor aparência' } 2 { 'melhor desempenho' } 3 { 'personalizado' } default { 'o Windows escolhe' } }
    fontes_suaves = ((Get-ItemProperty 'HKCU:\Control Panel\Desktop').FontSmoothing -eq '2')
    apps_em_segundo_plano = if ($bg -eq 1) { 'bloqueados' } else { 'permitidos (padrão)' }
  }

  $avisos = @()
  if ($base.memoria.ram_uso_pct -gt 85) { $avisos += 'RAM acima de 85% de uso.' }
  if ($base.memoria_virtual.desativada) { $avisos += 'Memória virtual desativada.' }
  if ($base.disco_c.livre_gb -lt 30) { $avisos += 'Pouco espaço livre no C:.' }
  $base.gpu.placas | Where-Object { $_.data_driver -and ([datetime]$_.data_driver) -lt (Get-Date).AddYears(-2) } | ForEach-Object { $avisos += "Driver antigo: $($_.nome) ($($_.data_driver))." }
  $base.avisos = $avisos
  $base.resumo = "RAM $($base.memoria.ram_livre_gb) de $ramTotal GB livres ($($base.memoria.ram_uso_pct)% em uso); C: $($base.disco_c.livre_gb) de $($base.disco_c.total_gb) GB livres; energia: $($base.energia.plano_ativo)."
  return $base
}

# ───────────────────────────── Otimizar ─────────────────────────────

$script:Estado = New-Object System.Collections.ArrayList
$script:Aplicado = New-Object System.Collections.ArrayList
$script:Pendente = New-Object System.Collections.ArrayList
$script:Liberado = [ordered]@{}

function Set-RegComBackup([string]$Chave, [string]$Nome, $Valor, [string]$Tipo = 'String') {
  $existe = $false; $antigo = $null; $tipoAntigo = $null
  if (Test-Path $Chave) {
    $item = Get-Item $Chave
    if ($item.GetValueNames() -contains $Nome) {
      $existe = $true; $antigo = $item.GetValue($Nome, $null, 'DoNotExpandEnvironmentNames'); $tipoAntigo = [string]$item.GetValueKind($Nome)
    }
  } else { New-Item -Path $Chave -Force | Out-Null }
  if ($existe -and ($antigo -is [array] -or $Valor -is [array])) { if ((@($antigo) -join ',') -eq (@($Valor) -join ',')) { return $false } }
  elseif ($existe -and [string]$antigo -eq [string]$Valor) { return $false }
  [void]$script:Estado.Add([ordered]@{ chave = $Chave; nome = $Nome; existia = $existe; valor = $antigo; tipo = $tipoAntigo })
  New-ItemProperty -Path $Chave -Name $Nome -Value $Valor -PropertyType $Tipo -Force | Out-Null
  return $true
}

function Remove-Antigos([string]$Pasta, [datetime]$Limite, [string]$Filtro = '*') {
  $bytes = 0L; $n = 0; $pulados = 0
  if (-not (Test-Path -LiteralPath $Pasta)) { return @{ bytes = 0; arquivos = 0; pulados = 0 } }
  Get-ChildItem -LiteralPath $Pasta -Recurse -Force -File -Filter $Filtro -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $Limite } | ForEach-Object {
      $len = $_.Length
      try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop; $bytes += $len; $n++ } catch { $pulados++ }
    }
  # Pastas vazias antigas
  Get-ChildItem -LiteralPath $Pasta -Recurse -Force -Directory -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending |
    Where-Object { $_.LastWriteTime -lt $Limite -and -not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue) } |
    ForEach-Object { try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop } catch {} }
  @{ bytes = $bytes; arquivos = $n; pulados = $pulados }
}

function Add-Liberado([string]$Item, [double]$Bytes, [string]$Obs = '') {
  $script:Liberado[$Item] = [ordered]@{ gb = [math]::Round($Bytes / 1GB, 3); obs = $Obs }
}

function Invoke-Otimizar {
  if (-not $Confirmar) {
    return [ordered]@{ ok = $false; erro = 'Modo otimizar exige confirmação explícita (-Confirmar).'; o_que_faria = @(
        'Limpar %TEMP% (arquivos com mais de 24h, pula os em uso)', 'Limpar crash dumps com mais de 7 dias e miniaturas',
        'pnpm store prune, pip cache purge, uv cache prune (npm não)', 'Plano Alto desempenho na tomada',
        'Preferência de GPU: IA na RTX, navegadores/Electron no iGPU', 'Modo de Jogo ligado; efeitos visuais para desempenho com fontes suaves',
        'Desativar só inicializações claramente dispensáveis (reversível)', 'Gerar desfazer.ps1 e rodar-como-admin.ps1') }
  }
  $admin = Test-Admin
  if (-not $PastaBackup) { $PastaBackup = Join-Path $env:USERPROFILE ("Projetos\_arquivo\turbo-" + (Get-Date -Format 'yyyyMMdd')) }
  if (Test-Path (Join-Path $PastaBackup 'estado-anterior.json')) { $PastaBackup = $PastaBackup + '-' + (Get-Date -Format 'HHmmss') }
  New-Item -ItemType Directory -Path $PastaBackup -Force | Out-Null

  $antes = Get-Diagnostico -Leve
  $diagCompleto = Get-Diagnostico
  $diagCompleto | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $PastaBackup 'diagnostico-antes.json') -Encoding UTF8
  reg export 'HKCU\Software\Microsoft\DirectX\UserGpuPreferences' (Join-Path $PastaBackup 'gpu-prefs.reg') /y 2>$null | Out-Null
  reg export 'HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved' (Join-Path $PastaBackup 'startup-approved.reg') /y 2>$null | Out-Null

  # 1) Ponto de restauração
  if ($admin) {
    try { Enable-ComputerRestore -Drive 'C:\' -ErrorAction SilentlyContinue; Checkpoint-Computer -Description 'Mestre Turbo PC' -RestorePointType MODIFY_SETTINGS -ErrorAction Stop; [void]$script:Aplicado.Add('Ponto de restauração criado') }
    catch { [void]$script:Pendente.Add("Ponto de restauração: $($_.Exception.Message)") }
  } else { [void]$script:Pendente.Add('Ponto de restauração (precisa admin) — está no rodar-como-admin.ps1') }

  # 2) Limpeza
  $r = Remove-Antigos $env:TEMP (Get-Date).AddHours(-24)
  Add-Liberado 'TEMP do usuário' $r.bytes "$($r.arquivos) arquivos, $($r.pulados) em uso pulados"
  if ($admin) {
    $r = Remove-Antigos 'C:\Windows\Temp' (Get-Date).AddHours(-24); Add-Liberado 'Windows\Temp' $r.bytes "$($r.arquivos) arquivos"
  } else { [void]$script:Pendente.Add('Windows\Temp (precisa admin)') }
  $r = Remove-Antigos (Join-Path $env:LOCALAPPDATA 'CrashDumps') (Get-Date).AddDays(-7)
  Add-Liberado 'Crash dumps (>7 dias)' $r.bytes "$($r.arquivos) arquivos"
  $r = Remove-Antigos (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Explorer') (Get-Date) 'thumbcache_*.db'
  Add-Liberado 'Miniaturas' $r.bytes "$($r.pulados) em uso pelo Explorer"

  $pnpmStore = Join-Path $env:LOCALAPPDATA 'pnpm\store'
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    $a = Get-TamanhoGB $pnpmStore; pnpm store prune 2>&1 | Out-Null; $d = Get-TamanhoGB $pnpmStore
    if ($a -is [double] -and $d -is [double]) { Add-Liberado 'Store pnpm (prune)' (($a - $d) * 1GB) } else { Add-Liberado 'Store pnpm (prune)' 0 }
  }
  $pyCmd = if (Get-Command py -ErrorAction SilentlyContinue) { 'py' } elseif (Get-Command python -ErrorAction SilentlyContinue) { 'python' } else { $null }
  if ($pyCmd) {
    $pipDir = Join-Path $env:LOCALAPPDATA 'pip\Cache'; $a = Get-TamanhoGB $pipDir
    & $pyCmd -m pip cache purge 2>&1 | Out-Null; $d = Get-TamanhoGB $pipDir
    Add-Liberado 'Cache pip' $(if ($a -is [double] -and $d -is [double]) { ($a - $d) * 1GB } else { 0 })
  }
  if (Get-Command uv -ErrorAction SilentlyContinue) {
    $uvDir = Join-Path $env:LOCALAPPDATA 'uv\cache'; $a = Get-TamanhoGB $uvDir; uv cache prune 2>&1 | Out-Null; $d = Get-TamanhoGB $uvDir
    Add-Liberado 'Cache uv' $(if ($a -is [double] -and $d -is [double]) { ($a - $d) * 1GB } else { 0 })
  }
  [void]$script:Aplicado.Add('Limpeza de temporários, crash dumps, miniaturas e caches pnpm/pip/uv (npm não foi tocado)')

  # 3) Energia
  $en = $diagCompleto.energia
  $altoDesempenho = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'
  [void]$script:Estado.Add([ordered]@{ tipo = 'energia'; plano_guid = $en.plano_guid; plano = $en.plano_ativo })
  if (-not $en.na_tomada) { [void]$script:Pendente.Add('Plano de energia: notebook na bateria, mantido o atual') }
  elseif ($en.plano_guid -eq $altoDesempenho -or $en.plano_ativo -match 'Desempenho M|Ultimate') { [void]$script:Aplicado.Add("Plano de energia já estava em $($en.plano_ativo)") }
  else {
    powercfg /setactive $altoDesempenho 2>$null
    if ($LASTEXITCODE -eq 0) { [void]$script:Aplicado.Add("Plano de energia: $($en.plano_ativo) -> Alto desempenho") } else { [void]$script:Pendente.Add('Plano Alto desempenho não existe neste PC') }
  }

  # 4) GPU por app
  $gpuKey = 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences'
  $L = $env:LOCALAPPDATA
  $alto = @("$L\Programs\Ollama\ollama.exe", "$L\Programs\Ollama\lib\ollama\llama-server.exe", 'C:\Python315\python.exe') +
          @(Get-ChildItem "$L\Programs\Python\Python3*\python.exe" -ErrorAction SilentlyContinue | ForEach-Object FullName) +
          @(Get-Command llama-server -ErrorAction SilentlyContinue | ForEach-Object Source)
  $economia = @('C:\Program Files\Google\Chrome\Application\chrome.exe', 'C:\Program Files\Google\Chrome Beta\Application\chrome.exe',
                'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', "$L\Programs\Obsidian\Obsidian.exe",
                "$L\Programs\Microsoft VS Code\Code.exe", "$L\Programs\Microsoft VS Code Insiders\Code - Insiders.exe") +
              @(Get-ChildItem "$env:USERPROFILE\Projetos" -Directory -Recurse -Depth 2 -Filter 'MULT-CHAT-HUB*' -ErrorAction SilentlyContinue |
                ForEach-Object { Join-Path $_.FullName 'node_modules\electron\dist\electron.exe' })
  $gpuMud = @()
  foreach ($par in @(@{ lista = $alto; v = 2 }, @{ lista = $economia; v = 1 })) {
    foreach ($exe in ($par.lista | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique)) {
      $atual = (Get-ItemProperty $gpuKey -Name $exe -ErrorAction SilentlyContinue).$exe
      $novo = if ($atual -and $atual -match 'GpuPreference=\d;') { $atual -replace 'GpuPreference=\d;', "GpuPreference=$($par.v);" } elseif ($atual) { $atual.TrimEnd(';') + ";GpuPreference=$($par.v);" } else { "GpuPreference=$($par.v);" }
      if (Set-RegComBackup $gpuKey $exe $novo) { $gpuMud += "$(Split-Path $exe -Leaf)=$(if ($par.v -eq 2) { 'RTX' } else { 'iGPU' })" }
    }
  }
  if ($gpuMud) { [void]$script:Aplicado.Add('GPU por app: ' + ($gpuMud -join ', ')) } else { [void]$script:Aplicado.Add('GPU por app: já estava configurado') }

  # 5) Modo de Jogo + efeitos visuais
  $m1 = Set-RegComBackup 'HKCU:\Software\Microsoft\GameBar' 'AutoGameModeEnabled' 1 'DWord'
  $m2 = Set-RegComBackup 'HKCU:\Software\Microsoft\GameBar' 'AllowAutoGameMode' 1 'DWord'
  [void]$script:Aplicado.Add($(if ($m1 -or $m2) { 'Modo de Jogo ligado' } else { 'Modo de Jogo já estava ligado' }))
  $vfxKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects'
  $vfx = (Get-ItemProperty $vfxKey -ErrorAction SilentlyContinue).VisualFXSetting
  $f = Set-RegComBackup 'HKCU:\Control Panel\Desktop' 'FontSmoothing' '2' 'String'
  if ($vfx -ne 2) {
    # Personalizado: animações e sombras desligadas, fontes suaves e miniaturas mantidas.
    Set-RegComBackup $vfxKey 'VisualFXSetting' 3 'DWord' | Out-Null
    Set-RegComBackup 'HKCU:\Control Panel\Desktop' 'UserPreferencesMask' ([byte[]](0x90, 0x12, 0x03, 0x80, 0x10, 0x00, 0x00, 0x00)) 'Binary' | Out-Null
    Set-RegComBackup 'HKCU:\Control Panel\Desktop\WindowMetrics' 'MinAnimate' '0' 'String' | Out-Null
    [void]$script:Aplicado.Add('Efeitos visuais: desempenho, mantendo fontes suaves (vale após sair e entrar na conta)')
  } else { [void]$script:Aplicado.Add('Efeitos visuais já estavam em melhor desempenho' + $(if ($f) { '; fontes suaves religadas' } else { ', com fontes suaves' })) }

  # 6) Inicialização
  $st = Get-Startup
  $desat = @(); $duvidosos = @()
  foreach ($it in $st.itens) {
    if (-not $it.ativo) { continue }
    if ($it.nome -match $Protegidos -or $it.comando -match $Protegidos) { continue }
    if ($it.nome -match $Dispensaveis -and $it.origem -in 'HKCU Run', 'Pasta Inicializar', 'StartupApproved') {
      $sub = if ($it.origem -eq 'Pasta Inicializar') { 'StartupFolder' } else { 'Run' }
      $k = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\$sub"
      $bytes = [byte[]](0x03, 0, 0, 0) + [BitConverter]::GetBytes((Get-Date).ToFileTime())
      if ($it.origem -eq 'Pasta Inicializar' -and $it.comando -like "$env:ProgramData*") { $duvidosos += "$($it.nome) (todos os usuários, precisa admin)"; continue }
      if (Set-RegComBackup $k $it.nome $bytes 'Binary') { $desat += $it.nome }
    } else { $duvidosos += "$($it.nome) [$($it.origem)]" }
  }
  foreach ($t in $st.tarefas_no_logon) { if ($t.nome -notmatch $Protegidos) { $duvidosos += "$($t.nome) [tarefa no logon]" } }
  [void]$script:Aplicado.Add($(if ($desat) { 'Inicialização desativada (reversível): ' + ($desat -join ', ') } else { 'Inicialização: nada claramente dispensável estava ativo' }))

  # 7) Arquivos de backup/desfazer/admin
  $estadoPath = Join-Path $PastaBackup 'estado-anterior.json'
  ConvertTo-Json -InputObject @($script:Estado) -Depth 6 | Set-Content -Path $estadoPath -Encoding UTF8
  $desfazer = @'
# desfazer.ps1 — gerado pelo Turbo PC do Mestre do PC. Restaura os valores de registro e o plano de energia anteriores.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File .\desfazer.ps1
$ErrorActionPreference = 'Continue'
$estado = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'estado-anterior.json') | ConvertFrom-Json
foreach ($e in @($estado)) {
  if ($e.tipo -eq 'energia') { if ($e.plano_guid) { powercfg /setactive $e.plano_guid; Write-Host "Plano de energia restaurado: $($e.plano)" }; continue }
  if (-not $e.existia) { Remove-ItemProperty -Path $e.chave -Name $e.nome -ErrorAction SilentlyContinue; Write-Host "Removido: $($e.chave)\$($e.nome)"; continue }
  $v = $e.valor
  if ($e.tipo -eq 'Binary') { $v = [byte[]]@($e.valor) }
  New-ItemProperty -Path $e.chave -Name $e.nome -Value $v -PropertyType $e.tipo -Force | Out-Null
  Write-Host "Restaurado: $($e.chave)\$($e.nome)"
}
Write-Host 'Pronto. Arquivos apagados (temporários/caches) não voltam; eles são recriados pelos apps quando precisarem.'
'@
  Write-Utf8Bom (Join-Path $PastaBackup 'desfazer.ps1') $desfazer

  $adminScript = @'
# rodar-como-admin.ps1 — gerado pelo Turbo PC do Mestre do PC.
# Abra o PowerShell como administrador e rode: powershell -NoProfile -ExecutionPolicy Bypass -File .\rodar-como-admin.ps1
# Não esvazia a Lixeira, não apaga arquivos pessoais e não reinicia o PC.
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Write-Host 'Rode como administrador.' -ForegroundColor Red; exit 1 }
$d0 = (Get-PSDrive C).Free
Write-Host '1/6 Ponto de restauração...'
try { Enable-ComputerRestore -Drive 'C:\'; Checkpoint-Computer -Description 'Mestre Turbo PC (admin)' -RestorePointType MODIFY_SETTINGS -ErrorAction Stop } catch { Write-Host "  $($_.Exception.Message)" -ForegroundColor Yellow }
Write-Host '2/6 Windows\Temp (arquivos com mais de 24h)...'
$lim = (Get-Date).AddHours(-24)
Get-ChildItem 'C:\Windows\Temp' -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $lim } | Remove-Item -Force -ErrorAction SilentlyContinue
Write-Host '3/6 Limpeza de componentes do Windows Update (DISM)...'
Dism.exe /Online /Cleanup-Image /StartComponentCleanup /Quiet /NoRestart
Write-Host '4/6 Cache de download do Windows Update...'
Stop-Service wuauserv, bits -Force -ErrorAction SilentlyContinue
Get-ChildItem 'C:\Windows\SoftwareDistribution\Download' -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Start-Service bits, wuauserv -ErrorAction SilentlyContinue
Write-Host '5/6 Retrim do SSD C:...'
Optimize-Volume -DriveLetter C -ReTrim -Verbose
Write-Host '6/6 Compressão de memória...'
$mm = Get-MMAgent; if (-not $mm.MemoryCompression) { Enable-MMAgent -MemoryCompression; Write-Host '  ligada (vale após reiniciar)' } else { Write-Host '  já estava ligada' }
Write-Host ("Liberado no C: {0:N2} GB" -f (((Get-PSDrive C).Free - $d0) / 1GB)) -ForegroundColor Green
# Opcional (desfaça com Set-Service DiagTrack -StartupType Automatic):
# Stop-Service DiagTrack; Set-Service DiagTrack -StartupType Disabled
'@
  if (-not $admin) {
    Write-Utf8Bom (Join-Path $PastaBackup 'rodar-como-admin.ps1') $adminScript
    [void]$script:Pendente.Add('Admin: Windows\Temp, DISM, cache do Windows Update, retrim do SSD, compressão de memória — rodar-como-admin.ps1')
  } else {
    $r = Remove-Antigos 'C:\Windows\Temp' (Get-Date).AddHours(-24); Add-Liberado 'Windows\Temp (admin)' $r.bytes
    try { Optimize-Volume -DriveLetter C -ReTrim -ErrorAction Stop; [void]$script:Aplicado.Add('Retrim do SSD C:') } catch { [void]$script:Pendente.Add("Retrim: $($_.Exception.Message)") }
  }

  $depois = Get-Diagnostico -Leve
  $res = [ordered]@{
    ok = $true
    modo = 'otimizar'
    pasta_backup = $PastaBackup
    desfazer = (Join-Path $PastaBackup 'desfazer.ps1')
    rodar_como_admin = if (-not $admin) { Join-Path $PastaBackup 'rodar-como-admin.ps1' } else { $null }
    antes = [ordered]@{ ram_livre_gb = $antes.memoria.ram_livre_gb; disco_livre_gb = $antes.disco_c.livre_gb }
    depois = [ordered]@{ ram_livre_gb = $depois.memoria.ram_livre_gb; disco_livre_gb = $depois.disco_c.livre_gb }
    liberado_por_item = $script:Liberado
    liberado_total_gb = [math]::Round((($script:Liberado.Values | ForEach-Object { $_.gb }) | Measure-Object -Sum).Sum, 3)
    aplicado = @($script:Aplicado)
    pendente = @($script:Pendente)
    candidatos_duvidosos = $duvidosos
    so_reportado = @(
      "Agendamento de GPU por hardware: $($diagCompleto.gpu.agendamento_gpu_hardware)",
      "Memória virtual: $(if ($diagCompleto.memoria_virtual.automatica) { 'automática (mantida)' } else { 'manual (revise)' })",
      "Apps em segundo plano: $($diagCompleto.windows.apps_em_segundo_plano)",
      "Windows Search/SysMain mantidos (ajudam no SSD e na busca)"
    ) + @($diagCompleto.avisos)
    nunca_feito = @('Lixeira não foi esvaziada', 'Downloads/Documentos/Desktop intocados', 'Modelos do Ollama intocados', 'Cache npm intocado', 'PC não reiniciado')
  }
  $res | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $PastaBackup 'relatorio.json') -Encoding UTF8
  $md = @("# Turbo PC — $(Get-Date -Format 'dd/MM/yyyy HH:mm')", '',
    "| | Antes | Depois |", "|---|---|---|",
    "| RAM livre (GB) | $($res.antes.ram_livre_gb) | $($res.depois.ram_livre_gb) |",
    "| C: livre (GB) | $($res.antes.disco_livre_gb) | $($res.depois.disco_livre_gb) |", '',
    '## Liberado por item') + ($script:Liberado.Keys | ForEach-Object { "- $_ : $($script:Liberado[$_].gb) GB $($script:Liberado[$_].obs)" }) +
    @('', '## Aplicado') + ($res.aplicado | ForEach-Object { "- $_" }) +
    @('', '## Pendente') + ($res.pendente | ForEach-Object { "- $_" }) +
    @('', '## Candidatos duvidosos (não desativados)') + ($duvidosos | ForEach-Object { "- $_" }) +
    @('', '## Só reportado') + ($res.so_reportado | ForEach-Object { "- $_" }) +
    @('', "Desfazer: $($res.desfazer)")
  $md -join "`r`n" | Set-Content -Path (Join-Path $PastaBackup 'relatorio.md') -Encoding UTF8
  return $res
}

if ($Modo -eq 'diagnostico') {
  $saida = Get-Diagnostico
  $saida | ConvertTo-Json -Depth 8
  exit 0
}
$out = Invoke-Otimizar
$out | ConvertTo-Json -Depth 8
if (-not $out.ok) { exit 2 }
exit 0
