// Envelope dos comandos que o launcher roda no PowerShell e leitura do resultado.
//
// Antes, o job valia "sucesso" sempre que o powershell.exe saía com 0. Como a
// maioria das operações termina com `Write-Host "✅ ..."`, o processo saía com 0
// mesmo quando o passo principal falhava (Stop-Service sem admin, Erro 740 etc.)
// e o painel mostrava ✅. A saída também vinha com acentos e emojis quebrados,
// porque o Windows PowerShell 5.1 escreve na página de código OEM quando a saída
// é redirecionada e o Node lê como UTF-8.
//
// O envelope:
//  - força UTF-8 na saída;
//  - roda o comando num bloco com o fluxo de erro (2) redirecionado e conta os
//    erros que de fato apareceriam na tela. Erros tratados por try/catch ou
//    silenciados com -EA 0 / SilentlyContinue não contam, porque não chegam ao
//    fluxo de erro. Stderr de programa nativo (ollama, npm, winget...) passa como
//    texto e não conta: para eles vale o código de saída;
//  - captura erro fatal (throw, -EA Stop sem catch);
//  - no fim, sai com um código que o launcher entende (CODIGO_SAIDA).
//
// `exit N` dentro do comando continua valendo: o processo sai na hora com N.

export const CODIGO_SAIDA = Object.freeze({
  OK: 0,
  FALHOU: 1,
  COM_ERROS: 3,
  // scripts/admin-tools.ps1 sai com 10 quando só abriu a janela de administrador
  // (UAC). O resultado real fica naquela janela.
  ABERTO_COMO_ADMIN: 10,
});

export const RESULTADO = Object.freeze({
  OK: "ok",
  COM_ERROS: "com_erros",
  FALHOU: "falhou",
  ABERTO_COMO_ADMIN: "aberto_como_admin",
  TEMPO_ESGOTADO: "tempo_esgotado",
});

// Limite prático da linha de comando do Windows (CreateProcess) é 32767
// caracteres, contando o executável e as flags.
export const LIMITE_LINHA_COMANDO = 32000;

const PROLOGO = [
  "$ProgressPreference = 'SilentlyContinue'",
  "try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }",
  "$OutputEncoding = [System.Text.Encoding]::UTF8",
  "$global:LASTEXITCODE = 0",
  "$__mestreErros = 0",
  "try {",
  "& {",
].join("\n");

const EPILOGO = [
  "} 2>&1 | ForEach-Object {",
  "  if ($_ -is [System.Management.Automation.ErrorRecord]) {",
  "    if ($_.FullyQualifiedErrorId -like 'NativeCommandError*') { \"$_\" }",
  "    else { $__mestreErros++; Write-Host ('[ERRO] ' + $_.ToString()) -ForegroundColor Red }",
  "  } else { $_ }",
  "}",
  "} catch {",
  "  Write-Host ('[ERRO] ' + $_.Exception.Message) -ForegroundColor Red",
  "  $__mestreErros = -1",
  "}",
  "$__mestreNativo = $global:LASTEXITCODE",
  `if ($__mestreNativo -eq ${CODIGO_SAIDA.ABERTO_COMO_ADMIN}) { exit ${CODIGO_SAIDA.ABERTO_COMO_ADMIN} }`,
  "if ($__mestreErros -ne 0 -or ($null -ne $__mestreNativo -and $__mestreNativo -ne 0)) {",
  "  $__mestreAdmin = $false",
  "  try { $__mestreAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch { }",
  "  $__mestrePermissao = @($Error | Where-Object { $_.CategoryInfo.Category -eq 'PermissionDenied' -or $_.Exception -is [System.UnauthorizedAccessException] -or \"$_\" -match 'requires elevation|requer eleva|\\b740\\b|Acesso negado|Access is denied' }).Count -gt 0",
  "  if ($__mestrePermissao -and -not $__mestreAdmin) { Write-Host '[MESTRE] Este comando precisa de administrador. Inicie o Mestre do PC como administrador e rode de novo.' -ForegroundColor Yellow }",
  `  if ($__mestreErros -lt 0) { exit ${CODIGO_SAIDA.FALHOU} }`,
  `  if ($null -ne $__mestreNativo -and $__mestreNativo -ne 0) { Write-Host ("[MESTRE] O programa terminou com código $__mestreNativo.") -ForegroundColor Red; exit ${CODIGO_SAIDA.FALHOU} }`,
  `  Write-Host ("[MESTRE] Concluído com $__mestreErros erro(s). Veja as linhas [ERRO] acima.") -ForegroundColor Yellow`,
  `  exit ${CODIGO_SAIDA.COM_ERROS}`,
  "}",
  `exit ${CODIGO_SAIDA.OK}`,
].join("\n");

/** Envolve o comando da whitelist (ou do Modo Livre) no envelope acima. */
export function envolverComando(cmd) {
  return `${PROLOGO}\n${String(cmd)}\n${EPILOGO}`;
}

/**
 * Traduz o código de saída do envelope em resultado.
 * `elevado` vem do catálogo: só as operações que passam por admin-tools.ps1
 * podem devolver "aberto_como_admin"; em qualquer outra, 10 é falha comum.
 */
export function resultadoDoCodigo(codigo, { elevado = false } = {}) {
  if (codigo === CODIGO_SAIDA.OK) return RESULTADO.OK;
  if (codigo === CODIGO_SAIDA.COM_ERROS) return RESULTADO.COM_ERROS;
  if (codigo === CODIGO_SAIDA.ABERTO_COMO_ADMIN && elevado) return RESULTADO.ABERTO_COMO_ADMIN;
  return RESULTADO.FALHOU;
}
