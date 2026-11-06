param(
    [Parameter(Mandatory=$true)][string]$IdfPath,
    [Parameter(Mandatory=$true)][string]$IdfToolsPath,
    [Parameter(Mandatory=$true)][string]$PythonExe,
    [string]$StageRoot = 'D:/lease-voice-build'
)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path $PSScriptRoot -Parent
$env:IDF_PATH = (Resolve-Path -LiteralPath $IdfPath).Path
$env:IDF_TOOLS_PATH = (Resolve-Path -LiteralPath $IdfToolsPath).Path
$PythonExe = (Resolve-Path -LiteralPath $PythonExe).Path
$versionFile = Get-Content (Join-Path $env:IDF_PATH 'tools/cmake/version.cmake') -Raw
foreach ($part in @(@('MAJOR','5'), @('MINOR','3'), @('PATCH','1'))) {
    if ($versionFile -notmatch ('set\(IDF_VERSION_' + $part[0] + '\s+' + $part[1] + '\)')) {
        throw 'This source targets ESP-IDF 5.3.1; do not install or change SDK automatically'
    }
}
if (!(Test-Path -LiteralPath (Join-Path $env:IDF_TOOLS_PATH 'espidf.constraints.v5.3.txt'))) {
    throw 'Local IDF 5.3 constraints missing; stop and report to user'
}
if ($StageRoot -match '\s' -or $env:IDF_PATH -match '\s' -or $env:IDF_TOOLS_PATH -match '\s') {
    throw 'SDK, tool and staging paths must not contain spaces'
}
# Only export/check installed tools. No installer, downloader or export.ps1 invocation.
$toolExports = & $PythonExe (Join-Path $env:IDF_PATH 'tools/idf_tools.py') export --format key-value
if ($LASTEXITCODE -ne 0) { throw 'Installed IDF tools are incomplete; stop and report' }
foreach ($line in $toolExports) {
    if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $exportName = $Matches[1]
        $exportValue = $Matches[2]
        if ($exportName -eq 'PATH') { $exportValue = $exportValue.Replace('%PATH%', $env:PATH) }
        [Environment]::SetEnvironmentVariable($exportName, $exportValue, 'Process')
    }
}
$env:IDF_COMPONENT_MANAGER = '0'
$env:IDF_SKIP_CHECK_SUBMODULES = '1'
$env:IDF_TARGET = 'esp32s3'
$cmakeText = Get-Content (Join-Path $sourceRoot 'CMakeLists.txt') -Raw
$version = [regex]::Match($cmakeText, 'set\(PROJECT_VER "([^"]+)"\)').Groups[1].Value
if ($version -notmatch '^0\.[0-9]+\.[0-9]+-m[0123]\.[0-9]+$') { throw 'Invalid firmware PROJECT_VER' }
$delivery = Join-Path $sourceRoot "artifacts/$version"
if (Test-Path -LiteralPath $delivery) { throw "Delivery already exists; use a new version: $delivery" }
# Fresh staging prevents an old SDK/configuration or removed sources leaking into a build.
$stage = Join-Path $StageRoot ($version + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
foreach ($name in @('CMakeLists.txt', 'sdkconfig.defaults', 'partitions.csv', 'README.md')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination $stage
}
foreach ($directory in @('main', 'scripts', 'docs', 'components')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $directory) -Destination $stage -Recurse
}
Push-Location $stage
try {
    # IDF 5.3.1 dependency checks use local constraints; component manager is disabled.
    # Windows PowerShell wraps redirected native stderr as ErrorRecord, even
    # for informational IDF/CMake messages. Preserve the log and judge the
    # native process by its exit code rather than aborting on the first line.
    $savedErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $PythonExe (Join-Path $env:IDF_PATH 'tools/idf.py') build 2>&1 | Tee-Object -FilePath (Join-Path $stage 'build.log')
        $buildExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedErrorActionPreference }
    if ($buildExitCode -ne 0) { throw 'ESP-IDF build failed; see staging build.log' }
    & $PythonExe (Join-Path $stage 'scripts/package.py') --source $sourceRoot --stage $stage --output $delivery
    if ($LASTEXITCODE -ne 0) { throw 'Packaging failed; do not deliver incomplete output' }
    & $PythonExe (Join-Path $stage 'scripts/verify.py') $delivery
    if ($LASTEXITCODE -ne 0) { throw 'Release verification failed; do not deliver' }
    Write-Output "Firmware build and offline release checks passed: $delivery"
} finally { Pop-Location }
