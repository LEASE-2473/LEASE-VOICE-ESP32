param([string]$Port, [string]$Python = 'python', [switch]$Check)
$ErrorActionPreference = 'Stop'
$release = Join-Path $PSScriptRoot '../firmware/esp32-s3/release'
$manifest = Get-Content -LiteralPath (Join-Path $release 'manifest.json') -Raw | ConvertFrom-Json
foreach ($image in $manifest.images) {
    $path = Join-Path $release $image.file
    if ((Get-Item -LiteralPath $path).Length -ne $image.size -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower() -ne $image.sha256) { throw "固件校验失败：$($image.file)" }
}
if ($Check) { Write-Host '三镜像长度及 SHA256 校验通过，未访问串口'; exit 0 }
Write-Host ('检测到串口：' + (([IO.Ports.SerialPort]::GetPortNames() | Sort-Object) -join ', '))
if (!$Port) { $Port = Read-Host '选择串口，例如 COM3（可拔插设备后核对）' }
if ($Port -notmatch '^COM[1-9][0-9]*$') { throw '串口格式无效' }
& $Python -m esptool version
if ($LASTEXITCODE -ne 0) { throw '需要 Python 及 esptool 4.8.1：python -m pip install esptool==4.8.1；也可用 -Python 指定已有环境' }
Write-Host '仅支持配套 ESP32-S3 N16R8 / 16MB Flash；将覆盖 bootloader、分区表和应用。请先备份，不会备份现有设备。'
if ((Read-Host '确认型号并同意烧录，输入 FLASH') -cne 'FLASH') { exit 1 }
& $Python -m esptool --chip esp32s3 --port $Port --baud 115200 --before default_reset --after hard_reset write_flash --flash_mode dio --flash_freq 40m --flash_size 16MB 0x0 (Join-Path $release 'bootloader.bin') 0x8000 (Join-Path $release 'partition-table.bin') 0x10000 (Join-Path $release 'lease_voice.bin')
if ($LASTEXITCODE -ne 0) { throw '烧录失败，未开始配网' }
& (Join-Path $PSScriptRoot 'device-setup.ps1') -Port $Port

