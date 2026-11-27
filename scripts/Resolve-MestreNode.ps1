# Resolve o node.exe da tarefa MestreDoPC_Admin_Launcher.
# Nao assume C:\Program Files\nodejs. A tarefa guarda o caminho achado aqui:
# primeiro o node do PATH, depois %LOCALAPPDATA%\Programs\nodejs\node.exe
# e so entao Program Files.

function Resolve-MestreNode {
    $fromPath = Get-Command node -ErrorAction SilentlyContinue
    if ($fromPath -and $fromPath.Source -and (Test-Path -LiteralPath $fromPath.Source)) {
        return $fromPath.Source
    }
    $candidates = @(
        $env:MESTRE_NODE_PATH,
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe"),
        (Join-Path $env:ProgramFiles "nodejs\node.exe")
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }
    return $null
}
